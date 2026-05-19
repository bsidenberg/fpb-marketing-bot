// ============================================================
// api/meta-creative.js — upload an image to Meta and create an ad creative
//
// POST /api/meta-creative
//   Auth: x-execute-secret (server-only — see DEPLOY.md)
//   Optional: ?account=<slug> or x-account-slug header (defaults to 'fpb')
//
// Stage B1 retrofit:
//   • Account-scoped via resolveForWrite (rejects archived/inactive with 403).
//   • Access token + ad account ID now come from ad_platform_connections
//     via getConnectionForAccount. Hardcoded META_ACCESS_TOKEN /
//     META_AD_ACCOUNT_ID env vars are no longer read on this path.
//   • Missing connection: 404 CONNECTION_NOT_FOUND.
//     Connection missing required resolved_* field: 503 CONNECTION_INCOMPLETE.
//   • automation_log insert now carries account_id.
//
// META_PAGE_ID remains env-resolved for now. A future stage will move it
// to ad_platform_connections.metadata once we have a per-account page map.
// ============================================================

import supabase from './lib/supabase.js';
import {
  resolveForWrite,
  getConnectionForAccount,
  checkConnectionFields,
} from './lib/accounts.js';
import { setCorsHeaders } from './lib/cors.js';
import { requireSecret } from './lib/require-secret.js';

export default async function handler(req, res) {
  setCorsHeaders(req, res, { methods: 'POST, OPTIONS', headers: 'Content-Type, x-execute-secret, x-account-slug' });
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  if (!requireSecret(req, res, { envVar: 'EXECUTE_SECRET', header: 'x-execute-secret', label: '/api/meta-creative' })) return;

  const account = await resolveForWrite(req, res);
  if (!account) return;

  const {
    imageBase64,
    mediaType    = 'image/jpeg',
    format       = 'feed',
    adName       = 'FPB Ad Creative',
    headline     = 'Get Your Free Quote Today',
    primaryText  = 'Florida Pole Barn Kits — Built for Florida.',
    callToAction = 'LEARN_MORE',
  } = req.body || {};

  if (!imageBase64) {
    return res.status(400).json({ success: false, error: 'Missing imageBase64' });
  }

  const connection = await getConnectionForAccount(account.id, 'meta_ads');
  if (!connection) {
    return res.status(404).json({
      success: false,
      error:   `No meta_ads connection configured for account ${account.slug}`,
      code:    'CONNECTION_NOT_FOUND',
    });
  }
  const missing = checkConnectionFields(connection, 'meta_ads');
  if (missing) {
    return res.status(503).json({
      success: false,
      error:   `meta_ads connection for ${account.slug} is incomplete: ${missing}`,
      code:    'CONNECTION_INCOMPLETE',
    });
  }

  const accessToken  = connection.resolved_access_token;
  const rawAccountId = connection.resolved_account_id_external;
  const adAccountId  = rawAccountId.startsWith('act_') ? rawAccountId : `act_${rawAccountId}`;
  const pageId       = String(process.env.META_PAGE_ID);
  const apiBase      = 'https://graph.facebook.com/v19.0';

  const ctaMap = {
    GET_QUOTE: 'GET_QUOTE', LEARN_MORE: 'LEARN_MORE',
    CONTACT_US: 'CONTACT_US', SHOP_NOW: 'SHOP_NOW',
    SIGN_UP: 'SIGN_UP', SUBSCRIBE: 'SUBSCRIBE',
  };
  const ctaType = ctaMap[callToAction] || 'LEARN_MORE';

  // ── STEP 0: Diagnostic — verify token can see pages ─────────────────────
  const testRes  = await fetch(`${apiBase}/me/accounts?access_token=${accessToken}`);
  const testJson = await testRes.json();
  console.log('Page accounts accessible:', JSON.stringify(testJson));

  // ── STEP 1: Upload image to Meta ad image library ─────────────────────────
  let imageHash;
  try {
    // Build multipart/form-data manually — Node fetch doesn't have FormData with file bytes
    const boundary = '----FPBBoundary' + Date.now().toString(16);
    const crlf     = '\r\n';

    // Meta accepts raw base64 in the 'bytes' field
    const bodyParts = [
      `--${boundary}${crlf}`,
      `Content-Disposition: form-data; name="bytes"${crlf}${crlf}`,
      imageBase64,
      `${crlf}--${boundary}--${crlf}`,
    ].join('');

    const uploadRes = await fetch(`${apiBase}/${adAccountId}/adimages`, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type':  `multipart/form-data; boundary=${boundary}`,
      },
      body: bodyParts,
    });

    const uploadJson = await uploadRes.json();

    if (uploadJson.error) {
      throw new Error(uploadJson.error.message || `Meta upload error code ${uploadJson.error.code}`);
    }

    // Response shape: { images: { [filename]: { hash, url, ... } } }
    const images = uploadJson.images || {};
    const firstKey = Object.keys(images)[0];
    if (!firstKey || !images[firstKey]?.hash) {
      throw new Error('Meta image upload succeeded but no hash returned');
    }
    imageHash = images[firstKey].hash;

  } catch (err) {
    return res.status(500).json({ success: false, error: err.message, step: 'upload_image' });
  }

  // ── STEP 2: Create ad creative ────────────────────────────────────────────
  let creativeId;
  try {
    const creativeBody = {
      name: adName,
      object_story_spec: {
        page_id:   pageId,
        link_data: {
          image_hash: imageHash,
          link:       'https://floridapolebarn.com',
          message:    primaryText || 'Florida Pole Barn Kits — Built for Florida.',
          name:       headline    || 'Get Your Free Quote Today',
          call_to_action: { type: ctaType },
        },
      },
    };

    const creativeUrl = `${apiBase}/${adAccountId}/adcreatives?access_token=${encodeURIComponent(accessToken)}`;
    console.log('Meta creative request:', JSON.stringify(creativeBody));

    const creativeRes = await fetch(creativeUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(creativeBody),
    });

    const creativeJson = await creativeRes.json();

    if (creativeJson.error) {
      console.error('Meta creative error:', JSON.stringify(creativeJson));
      throw new Error(creativeJson.error.message || `Meta creative error code ${creativeJson.error.code}`);
    }
    if (!creativeJson.id) {
      throw new Error('Ad creative created but no ID returned');
    }

    creativeId = creativeJson.id;

  } catch (err) {
    return res.status(500).json({ success: false, error: err.message, step: 'create_creative' });
  }

  // ── STEP 3: Log to automation_log (account-scoped) ────────────────────────
  try {
    await supabase.from('automation_log').insert({
      account_id:  account.id,
      event_type:  'creative_uploaded',
      platform:    'meta_ads',
      status:      'complete',
      description: `Ad creative "${adName}" uploaded to Meta`,
      metadata:    { creativeId, imageHash, format },
    });
  } catch { /* swallow log errors — don't fail the whole request */ }

  return res.status(200).json({
    success:    true,
    creativeId,
    imageHash,
    previewUrl: `https://www.facebook.com/ads/creativehub/creative/?id=${creativeId}`,
  });
}

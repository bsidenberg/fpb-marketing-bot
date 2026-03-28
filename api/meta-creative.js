// Required env var: META_PAGE_ID — your Facebook Page ID
// Find it at: facebook.com/your-page → About → Page transparency → Page ID
// Add to Vercel: Settings → Environment Variables → META_PAGE_ID

import supabase from './lib/supabase.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function cors(res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

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

  const accessToken  = process.env.META_ACCESS_TOKEN;
  const adAccountId  = process.env.META_AD_ACCOUNT_ID;
  const pageId       = process.env.META_PAGE_ID;
  const apiBase      = 'https://graph.facebook.com/v19.0';

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

    const uploadRes = await fetch(`${apiBase}/act_${adAccountId}/adimages`, {
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
          message:    primaryText,
          name:       headline,
          call_to_action: {
            type:  callToAction,
            value: { link: 'https://floridapolebarn.com' },
          },
        },
      },
    };

    const creativeUrl = new URL(`${apiBase}/act_${adAccountId}/adcreatives`);
    creativeUrl.searchParams.set('access_token', accessToken);

    const creativeRes = await fetch(creativeUrl.toString(), {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(creativeBody),
    });

    const creativeJson = await creativeRes.json();

    if (creativeJson.error) {
      throw new Error(creativeJson.error.message || `Meta creative error code ${creativeJson.error.code}`);
    }
    if (!creativeJson.id) {
      throw new Error('Ad creative created but no ID returned');
    }

    creativeId = creativeJson.id;

  } catch (err) {
    return res.status(500).json({ success: false, error: err.message, step: 'create_creative' });
  }

  // ── STEP 3: Log to automation_log ─────────────────────────────────────────
  try {
    await supabase.from('automation_log').insert({
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

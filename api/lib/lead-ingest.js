// ============================================================
// api/lib/lead-ingest.js — lead normalization and deduplication
//
// Pure functions — no DB, no network.
// Imported by api/leads.js and tests.
// ============================================================

// ── Source platform mapping ───────────────────────────────────────────────────

const GOOGLE_SIGNALS = ['google', 'google_ads', 'google-ads', 'cpc', 'ppc', 'adwords', 'goog'];
const META_SIGNALS   = ['facebook', 'instagram', 'meta', 'fb', 'ig', 'meta_ads', 'meta-ads'];
const ORGANIC_SIGNALS = ['organic', 'seo', 'direct', '(none)', 'none'];
const REFERRAL_SIGNALS = ['referral', 'email', 'newsletter'];

/**
 * Map a raw source string to a normalized source_platform.
 * @param {string|null} raw
 * @returns {'google'|'meta'|'organic'|'referral'|'unknown'}
 */
export function mapSourcePlatform(raw) {
  if (!raw) return 'unknown';
  const s = String(raw).toLowerCase().trim();
  if (GOOGLE_SIGNALS.some(sig => s.includes(sig)))   return 'google';
  if (META_SIGNALS.some(sig => s.includes(sig)))      return 'meta';
  if (ORGANIC_SIGNALS.some(sig => s === sig))         return 'organic';
  if (REFERRAL_SIGNALS.some(sig => s.includes(sig)))  return 'referral';
  return 'unknown';
}

// ── UTM parsing ───────────────────────────────────────────────────────────────

/**
 * Parse UTM params from a URL string.
 * @param {string|null} url
 * @returns {{ utm_source, utm_medium, utm_campaign, utm_content, utm_term }}
 */
export function parseUtmFromUrl(url) {
  const empty = { utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null, utm_term: null };
  if (!url) return empty;
  try {
    // Handle URLs that may be relative or missing protocol
    const fullUrl = url.startsWith('http') ? url : `https://example.com${url.startsWith('/') ? '' : '/'}${url}`;
    const params  = new URL(fullUrl).searchParams;
    return {
      utm_source:   params.get('utm_source')   || null,
      utm_medium:   params.get('utm_medium')   || null,
      utm_campaign: params.get('utm_campaign') || null,
      utm_content:  params.get('utm_content')  || null,
      utm_term:     params.get('utm_term')     || null,
    };
  } catch {
    return empty;
  }
}

// ── Payload normalizers ───────────────────────────────────────────────────────

/**
 * Normalize a Gravity Forms / WordPress webhook payload.
 * Gravity Forms sends entries as field_1, field_2, etc. OR named
 * if the webhook is configured with field labels.
 *
 * Also handles WPForms-style `fields` array.
 * @param {object} body
 * @returns {object} normalized fields
 */
export function normalizeGravityForms(body) {
  // Named fields (webhook configured to use field labels as keys)
  const named = body.entry || body;

  // WPForms sends body.fields as an object keyed by field ID
  const wpFields = body.fields || {};

  const getField = (...keys) => {
    for (const k of keys) {
      const v = named[k] ?? wpFields[k];
      if (v != null && String(v).trim() !== '') return String(v).trim();
    }
    return null;
  };

  // Contact info — try common label variants
  const contact_name  = getField('name', 'full_name', 'your_name', 'Name', 'Full Name', 'field_1');
  const contact_email = getField('email', 'your_email', 'Email', 'Email Address', 'field_2');
  const contact_phone = getField('phone', 'phone_number', 'your_phone', 'Phone', 'Phone Number', 'field_3');
  const contact_location = getField('location', 'city', 'zip', 'address', 'Location', 'field_4');
  const notes         = getField('message', 'comments', 'how_can_we_help', 'Message', 'field_5');

  // UTMs from landing page URL
  const landingPage = getField('source_url', 'landing_page', 'page_url', 'referrer', 'gf_referer');
  const utms        = parseUtmFromUrl(landingPage);

  // Also check flat utm_ fields (sometimes Gravity Forms passes these directly)
  const utm_source   = getField('utm_source')   || utms.utm_source;
  const utm_medium   = getField('utm_medium')   || utms.utm_medium;
  const utm_campaign = getField('utm_campaign') || utms.utm_campaign;
  const utm_content  = getField('utm_content')  || utms.utm_content;
  const utm_term     = getField('utm_term')     || utms.utm_term;

  const rawSource    = utm_source || getField('source', 'traffic_source');
  const source_platform = mapSourcePlatform(rawSource);

  return {
    source_platform,
    lead_type:         'form',
    contact_name,
    contact_email,
    contact_phone,
    contact_location,
    utm_source,
    utm_medium,
    utm_campaign,
    utm_content,
    utm_term,
    keyword:           utm_term,
    notes,
    attribution_confidence: utm_source ? 'medium' : 'low',
    external_id:       getField('entry_id', 'id', 'lead_id'),
  };
}

/**
 * Normalize a CallRail webhook payload.
 * Ref: https://support.callrail.com/hc/en-us/articles/201615325-Webhook-Notification-Fields
 * @param {object} body
 * @returns {object} normalized fields
 */
export function normalizeCallRail(body) {
  const utms = parseUtmFromUrl(body.landing_page_url || body.referrer);

  const rawSource    = body.utm_source || utms.utm_source
                    || body.source     || body.tracking_source;
  const source_platform = mapSourcePlatform(rawSource);

  return {
    source_platform,
    lead_type:         'call',
    contact_name:      body.caller_name   || body.customer_name  || null,
    contact_phone:     body.caller_number || body.customer_phone_number || null,
    contact_location:  body.caller_city
                        ? `${body.caller_city}${body.caller_state ? ', ' + body.caller_state : ''}`
                        : null,
    utm_source:        body.utm_source    || utms.utm_source,
    utm_medium:        body.utm_medium    || utms.utm_medium,
    utm_campaign:      body.utm_campaign  || utms.utm_campaign,
    utm_content:       body.utm_content   || utms.utm_content,
    utm_term:          body.utm_term      || utms.utm_term,
    keyword:           body.keyword       || body.utm_term || utms.utm_term,
    campaign_name:     body.tracking_source || null,
    notes:             body.note          || body.transcription || null,
    attribution_confidence: body.utm_source ? 'high' : source_platform !== 'unknown' ? 'medium' : 'low',
    external_id:       body.id ? String(body.id) : null,
  };
}

/**
 * Normalize a generic / manual JSON payload.
 * Passes normalized platform-agnostic fields through directly.
 * @param {object} body
 * @returns {object} normalized fields
 */
export function normalizeGeneric(body) {
  const utms = parseUtmFromUrl(body.landing_page_url || body.page_url || body.referrer);

  const rawSource    = body.source_platform || body.utm_source || body.source
                    || utms.utm_source;
  const source_platform = mapSourcePlatform(rawSource) !== 'unknown'
    ? mapSourcePlatform(rawSource)
    : (body.source_platform || 'unknown');

  return {
    source_platform,
    lead_type:         body.lead_type     || 'unknown',
    contact_name:      body.contact_name  || body.name  || null,
    contact_email:     body.contact_email || body.email || null,
    contact_phone:     body.contact_phone || body.phone || null,
    contact_location:  body.contact_location || body.location || null,
    campaign_id:       body.campaign_id   || null,
    campaign_name:     body.campaign_name || null,
    ad_id:             body.ad_id         || null,
    ad_name:           body.ad_name       || null,
    ad_set_id:         body.ad_set_id     || null,
    ad_set_name:       body.ad_set_name   || null,
    keyword:           body.keyword       || body.utm_term || utms.utm_term || null,
    utm_source:        body.utm_source    || utms.utm_source,
    utm_medium:        body.utm_medium    || utms.utm_medium,
    utm_campaign:      body.utm_campaign  || utms.utm_campaign,
    utm_content:       body.utm_content   || utms.utm_content,
    utm_term:          body.utm_term      || utms.utm_term,
    estimated_value:   body.estimated_value ? parseFloat(body.estimated_value) : null,
    notes:             body.notes || body.message || null,
    attribution_confidence: body.attribution_confidence ||
      (body.utm_source || body.campaign_id ? 'medium' : 'low'),
    external_id:       body.external_id || body.id || null,
  };
}

// ── Source detection ──────────────────────────────────────────────────────────

/**
 * Detect webhook source type from payload shape.
 * @param {object} body
 * @returns {'callrail'|'gravity_forms'|'generic'}
 */
export function detectSource(body) {
  // CallRail has caller_number or tracking_source
  if (body.caller_number || body.tracking_source || body.caller_name) return 'callrail';

  // Gravity Forms has form_id or entry_id
  if (body.form_id || body.entry_id || body.form_title) return 'gravity_forms';

  // WPForms has fields array or wpforms key
  if (body.wpforms || body.fields) return 'gravity_forms';

  return 'generic';
}

/**
 * Normalize any incoming webhook body to lead fields.
 * Preserves the original body in raw_payload.
 * @param {object} body
 * @returns {object} { normalized, source_type }
 */
export function normalizePayload(body) {
  const source_type = detectSource(body);

  let normalized;
  if (source_type === 'callrail')      normalized = normalizeCallRail(body);
  else if (source_type === 'gravity_forms') normalized = normalizeGravityForms(body);
  else                                 normalized = normalizeGeneric(body);

  return { normalized, source_type };
}

// ── Deduplication ─────────────────────────────────────────────────────────────

/**
 * Build a deduplication key for a lead.
 *
 * Strategy (conservative — prefer false negatives over false positives):
 *   1. If external_id provided, use source_type::external_id
 *   2. If email provided, use email::YYYY-MM-DD
 *   3. If phone provided, use phone::YYYY-MM-DD (digits only)
 *   4. Otherwise null (cannot dedup)
 *
 * @param {object} normalized — output of normalizePayload
 * @param {string} source_type
 * @param {string} [dateStr] — YYYY-MM-DD, defaults to today
 * @returns {string|null}
 */
export function buildDedupKey(normalized, source_type, dateStr) {
  const day = dateStr || new Date().toISOString().slice(0, 10);

  if (normalized.external_id) {
    return `${source_type}::${normalized.external_id}`;
  }

  if (normalized.contact_email) {
    const email = normalized.contact_email.toLowerCase().trim();
    return `email::${email}::${day}`;
  }

  if (normalized.contact_phone) {
    const digits = normalized.contact_phone.replace(/\D/g, '');
    if (digits.length >= 7) return `phone::${digits}::${day}`;
  }

  return null;
}

// ============================================================
// tests/execute-action.test.js
// Behavioral tests for execute-action-logic.js.
// Supabase and fetch are mocked — no network, no DB.
//
// Stage B1: every executor takes (action, { account, connection }).
// Tests pass mock account + connection fixtures rather than relying on
// global env vars for ad-platform credentials.
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { STATUS, EXEC_RESULT } from '../api/lib/action-states.js';

// ── Queue-based Supabase mock ─────────────────────────────────────────────────
// Each .single() call pops the next result off the queue.
// Non-.single() terminal calls (update without select) resolve silently.

const singleQueue = [];

function makeChain() {
  const chain = {
    select:  () => makeChain(),
    eq:      () => makeChain(),
    in:      () => makeChain(),
    is:      () => makeChain(),
    update:  () => makeChain(),
    insert:  () => makeChain(),
    single:      async () => singleQueue.shift() ?? { data: null, error: null },
    maybeSingle: async () => singleQueue.shift() ?? { data: null, error: null },
    // Awaiting the chain directly (no .single()) — resolves silently
    then: (resolve) => resolve({ data: null, error: null }),
  };
  return chain;
}

vi.mock('../api/lib/supabase.js', () => ({
  default: { from: () => makeChain() },
}));

// ── Mock fetch ────────────────────────────────────────────────────────────────
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Import AFTER mocks are registered
import {
  acquireLockAndExecute,
  executeGoogle,
  executeMeta,
  executePublishCreative,
  executeCreateMetaCampaign,
} from '../api/lib/execute-action-logic.js';

// ── Account + connection fixtures ─────────────────────────────────────────────
const FPB_ACCOUNT = { id: 'fpb-uuid', slug: 'fpb', status: 'active' };

const GOOGLE_CONN = {
  account_id: 'fpb-uuid',
  platform:   'google_ads',
  connection_status:            'active',
  resolved_account_id_external: '8325311811',
  resolved_manager_account_id:  '5435219372',
  resolved_refresh_token:       'test-google-refresh-token',
  resolved_access_token:        null,
};

const META_CONN = {
  account_id: 'fpb-uuid',
  platform:   'meta_ads',
  connection_status:            'active',
  resolved_account_id_external: '123456789',
  resolved_access_token:        'test-meta-access-token',
  resolved_refresh_token:       null,
  resolved_manager_account_id:  null,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAction(overrides = {}) {
  return {
    id:               'action-123',
    account_id:       FPB_ACCOUNT.id,  // matches default test account context
    status:           STATUS.PENDING,
    action_type:      'pause_campaign',
    result:           null,
    execution_data:   {},
    ...overrides,
  };
}

/** Push results for .single() calls in order they'll be consumed */
function queueResults(...results) {
  singleQueue.length = 0;
  singleQueue.push(...results);
}

beforeEach(() => {
  vi.clearAllMocks();
  singleQueue.length = 0;

  // Globals that intentionally remain in env (per Stage B1 design)
  process.env.GOOGLE_ADS_CLIENT_ID       = 'test-client-id';
  process.env.GOOGLE_ADS_CLIENT_SECRET   = 'test-secret';
  process.env.GOOGLE_ADS_DEVELOPER_TOKEN = 'test-dev-token';
  process.env.META_PAGE_ID               = '987654321';

  // Remove per-account env vars that Stage B1 moved into ad_platform_connections
  delete process.env.GOOGLE_ADS_CUSTOMER_ID;
  delete process.env.GOOGLE_ADS_MANAGER_ID;
  delete process.env.GOOGLE_ADS_REFRESH_TOKEN;
  delete process.env.META_ACCESS_TOKEN;
  delete process.env.META_AD_ACCOUNT_ID;
});

// ── acquireLockAndExecute ─────────────────────────────────────────────────────

describe('acquireLockAndExecute', () => {

  it('returns 409 when action is in a final state (canExecute = false)', async () => {
    const finalAction = makeAction({ result: EXEC_RESULT.SUCCESS });
    queueResults({ data: finalAction, error: null }); // preflight

    const { httpStatus, body } = await acquireLockAndExecute('action-123', { account: FPB_ACCOUNT, connection: null });
    expect(httpStatus).toBe(409);
    expect(body.success).toBe(false);
  });

  it('returns 404 when action is not found', async () => {
    queueResults({ data: null, error: null }); // preflight miss — maybeSingle returns null/null for 0 rows

    const { httpStatus, body } = await acquireLockAndExecute('action-123', { account: FPB_ACCOUNT, connection: null });
    expect(httpStatus).toBe(404);
    expect(body.success).toBe(false);
  });

  it('returns 200 requires_manual for adjust_budget', async () => {
    const action = makeAction({ action_type: 'adjust_budget' });
    queueResults({ data: action, error: null }); // preflight

    const { httpStatus, body } = await acquireLockAndExecute('action-123', { account: FPB_ACCOUNT, connection: null });
    expect(httpStatus).toBe(200);
    expect(body.requires_manual).toBe(true);
    expect(body.executed).toBe(false);
  });

  it('returns 200 requires_manual for adjust_bid', async () => {
    const action = makeAction({ action_type: 'adjust_bid' });
    queueResults({ data: action, error: null }); // preflight

    const { httpStatus, body } = await acquireLockAndExecute('action-123', { account: FPB_ACCOUNT, connection: null });
    expect(httpStatus).toBe(200);
    expect(body.requires_manual).toBe(true);
  });

  it('returns 409 when lock acquisition fails (row already claimed)', async () => {
    const action = makeAction();
    queueResults(
      { data: action, error: null },                          // preflight: action found
      { data: null, error: { code: 'PGRST116', message: 'no rows' } }, // lock: already claimed
    );

    const { httpStatus, body } = await acquireLockAndExecute('action-123', { account: FPB_ACCOUNT, connection: META_CONN });
    expect(httpStatus).toBe(409);
    expect(body.success).toBe(false);
  });

  it('calls Meta API and returns success for pause_campaign on meta platform', async () => {
    const action = makeAction({
      action_type:    'pause_campaign',
      channel:        'meta',
      execution_data: { platform: 'meta', campaign_id: 'camp-456' },
    });
    const lockedRow = {
      account_id:     FPB_ACCOUNT.id,
      action_type:    'pause_campaign',
      channel:        'meta',
      execution_data: { platform: 'meta', campaign_id: 'camp-456' },
    };

    queueResults(
      { data: action,    error: null },  // preflight
      { data: lockedRow, error: null },  // lock acquired
    );

    // Meta campaign status API
    mockFetch.mockResolvedValueOnce({
      ok:   true,
      json: async () => ({ success: true }),
    });

    const { httpStatus, body } = await acquireLockAndExecute('action-123', { account: FPB_ACCOUNT, connection: META_CONN });
    expect(httpStatus).toBe(200);
    expect(body.success).toBe(true);
    expect(body.executed).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('graph.facebook.com'),
      expect.objectContaining({ method: 'POST' }),
    );
    // Verify the Meta access token used was from the connection, not env
    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain('access_token=test-meta-access-token');
  });

  it('calls Google Ads API and returns success for pause_campaign on google platform', async () => {
    const action = makeAction({
      action_type:    'pause_campaign',
      channel:        'google',
      execution_data: { campaign_id: 'gads-camp-1' },
    });
    const lockedRow = {
      account_id:     FPB_ACCOUNT.id,
      action_type:    'pause_campaign',
      channel:        'google',
      execution_data: { campaign_id: 'gads-camp-1' },
    };

    queueResults(
      { data: action,    error: null },
      { data: lockedRow, error: null },
    );

    // Two fetch calls: OAuth token exchange, then Google Ads mutate
    mockFetch
      .mockResolvedValueOnce({
        ok:   true,
        json: async () => ({ access_token: 'gads-access-token' }),
      })
      .mockResolvedValueOnce({
        ok:   true,
        text: async () => '{"results":[]}',
      });

    const { httpStatus, body } = await acquireLockAndExecute('action-123', { account: FPB_ACCOUNT, connection: GOOGLE_CONN });
    expect(httpStatus).toBe(200);
    expect(body.success).toBe(true);
    expect(body.executed).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][0]).toContain('oauth2.googleapis.com');
    expect(mockFetch.mock.calls[1][0]).toContain('googleads.googleapis.com');
    // Verify the OAuth refresh token came from the connection, not env
    const oauthBody = mockFetch.mock.calls[0][1].body.toString();
    expect(oauthBody).toContain('refresh_token=test-google-refresh-token');
  });

  it('calls Meta image upload + creative create for publish_creative action', async () => {
    const executionData = {
      imageBase64: 'base64imagedata',
      adName:      'Test Ad',
      headline:    'Test Headline',
      primaryText: 'Test text',
      callToAction: 'LEARN_MORE',
    };
    const action    = makeAction({ action_type: 'publish_creative', channel: 'meta', execution_data: executionData });
    const lockedRow = {
      account_id:     FPB_ACCOUNT.id,
      action_type:    'publish_creative',
      channel:        'meta',
      execution_data: executionData,
    };

    queueResults(
      { data: action,    error: null },
      { data: lockedRow, error: null },
    );

    mockFetch
      .mockResolvedValueOnce({
        ok:   true,
        json: async () => ({ images: { 'img1.jpg': { hash: 'imagehash-abc' } } }),
      })
      .mockResolvedValueOnce({
        ok:   true,
        json: async () => ({ id: 'creative-789' }),
      });

    const { httpStatus, body } = await acquireLockAndExecute('action-123', { account: FPB_ACCOUNT, connection: META_CONN });
    expect(httpStatus).toBe(200);
    expect(body.success).toBe(true);
    expect(body.executed).toBe(true);
    expect(body.creative_id).toBe('creative-789');
    expect(body.image_hash).toBe('imagehash-abc');
    // Both fetches used the connection's resolved access token (defensive 'act_' prefix applied)
    expect(mockFetch.mock.calls[0][0]).toContain('act_123456789/adimages');
    expect(mockFetch.mock.calls[1][0]).toContain('act_123456789/adcreatives');
  });

  it('creates Meta campaign + ad set for create_meta_campaign action', async () => {
    const executionData = {
      campaignName: 'Test Campaign',
      objective:    'LEAD_GENERATION',
      dailyBudget:  50,
    };
    const action    = makeAction({ action_type: 'create_meta_campaign', channel: 'meta', execution_data: executionData });
    const lockedRow = {
      account_id:     FPB_ACCOUNT.id,
      action_type:    'create_meta_campaign',
      channel:        'meta',
      execution_data: executionData,
    };

    queueResults(
      { data: action,    error: null },
      { data: lockedRow, error: null },
    );

    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'campaign-id-1' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'adset-id-1' }) });

    const { httpStatus, body } = await acquireLockAndExecute('action-123', { account: FPB_ACCOUNT, connection: META_CONN });
    expect(httpStatus).toBe(200);
    expect(body.executed).toBe(true);
    expect(body.campaign_id).toBe('campaign-id-1');
    expect(body.ad_set_id).toBe('adset-id-1');
    // Both fetches use unconditional 'act_' prefix per pre-existing inconsistency
    expect(mockFetch.mock.calls[0][0]).toContain('act_123456789/campaigns');
    expect(mockFetch.mock.calls[1][0]).toContain('act_123456789/adsets');
  });

  it('throws TOCTOU defense when action.account_id has changed since caller verification', async () => {
    // Caller passes FPB account, but the action row now has a different account_id
    const tampered = makeAction({ account_id: 'weld-uuid' });
    queueResults({ data: tampered, error: null });

    await expect(
      acquireLockAndExecute('action-123', { account: FPB_ACCOUNT, connection: META_CONN })
    ).rejects.toThrow(/TOCTOU/);
  });

  it('throws when account context is missing', async () => {
    await expect(
      acquireLockAndExecute('action-123', { connection: null })
    ).rejects.toThrow(/requires \{ account \} context/);
  });

});

// ── Executor null-connection guards ───────────────────────────────────────────

describe('executor null-connection guards', () => {
  const action = { action_type: 'pause_campaign', execution_data: { campaign_id: 'c1' } };

  it('executeGoogle throws when connection is null', async () => {
    await expect(executeGoogle(action, { account: FPB_ACCOUNT, connection: null }))
      .rejects.toThrow(/google_ads connection/);
  });

  it('executeGoogle throws when resolved_refresh_token is null', async () => {
    const conn = {
      resolved_account_id_external: '123',
      resolved_manager_account_id:  '456',
      resolved_refresh_token:       null,
    };
    await expect(executeGoogle(action, { account: FPB_ACCOUNT, connection: conn }))
      .rejects.toThrow(/refresh token/);
  });

  it('executeGoogle throws when resolved_account_id_external is null', async () => {
    const conn = {
      resolved_account_id_external: null,
      resolved_refresh_token:       'token',
    };
    await expect(executeGoogle(action, { account: FPB_ACCOUNT, connection: conn }))
      .rejects.toThrow(/customer ID/);
  });

  it('executeMeta throws when connection is null', async () => {
    await expect(executeMeta(action, { account: FPB_ACCOUNT, connection: null }))
      .rejects.toThrow(/meta_ads connection/);
  });

  it('executeMeta throws when resolved_access_token is null', async () => {
    await expect(executeMeta(action, { account: FPB_ACCOUNT, connection: { resolved_access_token: null } }))
      .rejects.toThrow(/access token/);
  });

  it('executePublishCreative throws when connection is null', async () => {
    const creativeAction = { action_type: 'publish_creative', execution_data: { imageBase64: 'x' } };
    await expect(executePublishCreative(creativeAction, { account: FPB_ACCOUNT, connection: null }))
      .rejects.toThrow(/meta_ads connection/);
  });

  it('executePublishCreative throws when resolved_access_token is null', async () => {
    const creativeAction = { action_type: 'publish_creative', execution_data: { imageBase64: 'x' } };
    const conn = { resolved_access_token: null, resolved_account_id_external: '123' };
    await expect(executePublishCreative(creativeAction, { account: FPB_ACCOUNT, connection: conn }))
      .rejects.toThrow(/access token/);
  });

  it('executeCreateMetaCampaign throws when connection is null', async () => {
    const campAction = { action_type: 'create_meta_campaign', execution_data: { campaignName: 'X' } };
    await expect(executeCreateMetaCampaign(campAction, { account: FPB_ACCOUNT, connection: null }))
      .rejects.toThrow(/meta_ads connection/);
  });

  it('executeCreateMetaCampaign throws when resolved_account_id_external is null', async () => {
    const campAction = { action_type: 'create_meta_campaign', execution_data: { campaignName: 'X' } };
    const conn = { resolved_access_token: 'token', resolved_account_id_external: null };
    await expect(executeCreateMetaCampaign(campAction, { account: FPB_ACCOUNT, connection: conn }))
      .rejects.toThrow(/ad account ID/);
  });

});

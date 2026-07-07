// ============================================================
// api/lib/negative-keyword-guard.js
//
// Terminal, bypass-proof check: run on the fully-assembled execution_data
// object right before EVERY actions-table insert of an add_negative_keyword
// row, regardless of which code path built it (chat.js staging, the
// generic /api/actions POST handler, or any future entry point). This
// checks the SAME field the executor reads (execution_data.keyword_text),
// not the pre-enrichment model payload, so it cannot be dodged by a
// missing/wrong channel or by skipping enrichment entirely.
// ============================================================

export const VALID_NEGATIVE_MATCH_TYPES = ['BROAD', 'PHRASE', 'EXACT'];

export function guardNegativeKeywordExecutionData(actionType, executionData) {
  if (actionType !== 'add_negative_keyword') return { ok: true };

  const keywordText = typeof executionData?.keyword_text === 'string' ? executionData.keyword_text.trim() : '';
  if (!keywordText) {
    return { ok: false, reason: 'negative keyword action missing keyword_text' };
  }

  if (executionData?.match_type != null) {
    const normalized = String(executionData.match_type).toUpperCase();
    if (!VALID_NEGATIVE_MATCH_TYPES.includes(normalized)) {
      return { ok: false, reason: `invalid match_type "${executionData.match_type}", expected BROAD/PHRASE/EXACT` };
    }
  }

  return { ok: true };
}

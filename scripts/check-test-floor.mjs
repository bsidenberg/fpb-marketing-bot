#!/usr/bin/env node
// ============================================================
// scripts/check-test-floor.mjs — the test floor, as a MACHINE CHECK.
//
// WHY THIS EXISTS
//
// CLAUDE.md and HARNESS.md both state a test floor that "rises and never
// falls". Until 2026-07-28 that was enforced by nobody: it was a sentence in a
// document, checked by whoever happened to read the number in a commit message.
// It did not hold — the count fell 710 -> 707 between commits d0a1f0e (S07e) and
// 92567dd (S07f) with no gate noticing (DECISIONS.md R-006).
//
// A floor that only a human enforces is not a floor. This script makes it an
// exit code.
//
// USAGE
//   node scripts/check-test-floor.mjs <path-to-test-output-log>
//
// Called by scripts/verify.ps1 (as its own named CHECK, so it appears in the
// evidence log) and by .github/workflows/verify.yml. Both parse the SAME vitest
// summary line from the SAME run — the floor cannot pass locally and fail in CI
// because of a different invocation.
//
// FAIL-CLOSED. If the log cannot be read, or the summary line cannot be found,
// or the count cannot be parsed, this EXITS NON-ZERO. An unparseable result is
// not a pass. That is the whole lesson of the silent-lint-skip: a check that
// cannot prove its claim must fail, never shrug.
// ============================================================

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot  = join(dirname(fileURLToPath(import.meta.url)), '..');
const floorPath = join(repoRoot, 'harness', 'TEST_FLOOR');

function fail(message) {
  console.error(`TEST FLOOR: FAIL — ${message}`);
  process.exit(1);
}

// ── The floor ────────────────────────────────────────────────────────────────
let floor;
try {
  const raw = readFileSync(floorPath, 'utf8').trim();
  floor = Number(raw);
  if (!Number.isInteger(floor) || floor < 0) {
    fail(`harness/TEST_FLOOR is not a non-negative integer (got "${raw}")`);
  }
} catch (err) {
  fail(`cannot read harness/TEST_FLOOR — ${err.message}`);
}

// ── The evidence ─────────────────────────────────────────────────────────────
const logPath = process.argv[2];
if (!logPath) fail('no log path given. Usage: node scripts/check-test-floor.mjs <log>');

let log;
try {
  log = readFileSync(logPath, 'utf8');
} catch (err) {
  fail(`cannot read test output "${logPath}" — ${err.message}`);
}

// Strip ANSI so this works whether or not the caller set NO_COLOR.
// The ESC byte is built with fromCharCode rather than written literally: a raw
// control character in source is invisible in every editor and diff, and ESLint's
// no-control-regex flags it for exactly that reason. The gate caught this in this
// very file on its first run -- which is precisely why the gate exists.
const ESC   = String.fromCharCode(27);
const plain = log.replace(new RegExp(ESC + '\\[[0-9;]*m', 'g'), '');

// vitest summary shapes:
//   "      Tests  838 passed (838)"
//   "      Tests  2 failed | 836 passed (838)"
// We take the PASSED count — a failing suite fails its own check anyway, and the
// floor is a statement about how many tests actually pass.
const matches = [...plain.matchAll(/^\s*Tests\s+(.+)$/gm)];
if (matches.length === 0) {
  fail(
    'no vitest "Tests" summary line found in the log. The suite may not have run. ' +
    'Refusing to pass a floor check with no evidence.',
  );
}

// Last summary line wins (a log may contain several runs; the final one is ours).
const summary = matches[matches.length - 1][1];
const passedMatch = summary.match(/(\d+)\s+passed/);
if (!passedMatch) {
  fail(`could not parse a passed-count from the vitest summary: "${summary.trim()}"`);
}

const passed = Number(passedMatch[1]);
const failedMatch = summary.match(/(\d+)\s+failed/);
const failed = failedMatch ? Number(failedMatch[1]) : 0;

// ── The verdict ──────────────────────────────────────────────────────────────
if (failed > 0) {
  fail(`${failed} test(s) failed. The floor is meaningless while the suite is red.`);
}

if (passed < floor) {
  fail(
    `${passed} tests passed, floor is ${floor}. The floor rises and never falls ` +
    `(CLAUDE.md). If tests were legitimately consolidated, that is a harness ` +
    `AMENDMENT — lower harness/TEST_FLOOR deliberately and say why in DECISIONS.md. ` +
    `Do not edit this script.`,
  );
}

if (passed > floor) {
  console.log(
    `TEST FLOOR: PASS — ${passed} tests passed, floor ${floor}. ` +
    `The floor should RISE to ${passed}: update harness/TEST_FLOOR in this session.`,
  );
} else {
  console.log(`TEST FLOOR: PASS — ${passed} tests passed, floor ${floor} (exactly at floor).`);
}

process.exit(0);

// ============================================================
// eslint.config.js — the lint half of the verification gate.
//
// WHY THIS FILE EXISTS (harness Phase 1.3, 2026-07-28)
//
// scripts/verify.ps1 runs `npm run lint` ONLY if package.json defines a `lint`
// script, and .github/workflows/verify.yml runs `npm run lint --if-present`.
// Neither existed. Both gates therefore skipped lint SILENTLY while still
// attesting "ALL CHECKS PASSED (2/2)" — see harness/evidence/
// S-08A-verify-2026-07-13_1727.log, which contains exactly two CHECK blocks
// (tests, build) — and harness/HARNESS.md §5 claimed the gate "runs
// `npm run lint`". A gate that lies is worse than no gate.
//
// SCOPE DISCIPLINE: this config is deliberately narrow. It enforces the class
// of defect that actually bites this repo — undefined identifiers, unreachable
// code, duplicate object keys, fall-through — and does NOT impose stylistic
// opinions on ~96 files of working, tested code. Widening the rule set is a
// harness amendment, not a drive-by.
//
// BASELINE BURNED TO ZERO (session S-LINT-1, 2026-07-30)
//
// The first lint run (Phase 1.3) surfaced 15 warnings: 12 unused identifiers
// (dead imports/vars, all removed — no test coverage was deleted, only dead
// bindings that no assertion ever read) and one no-prototype-builtins call in
// api/image-process.js:82. That call was rewritten as
// Object.prototype.hasOwnProperty.call(FORMAT_SPECS, format) —
// FORMAT_SPECS is a plain object literal, so this is behavior-identical for
// every input, including format values that collide with Object.prototype
// method names (e.g. "hasOwnProperty" itself). The header note that carried
// forward from Phase 1.3 claiming this fix "changes behavior" was itself an
// unverified claim (SDR-2) — checked here and found false; recorded in
// DECISIONS.md rather than silently corrected.
//
// Both `no-unused-vars` and `no-prototype-builtins` are now ERRORS, alongside
// the rest of js.configs.recommended. The repo is clean against every rule
// enabled here — that is the assertion the gate makes, and it is now provable
// for the full rule set, not just the correctness subset.
// ============================================================

import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';

export default [
  {
    // Never lint generated, vendored, or archived output.
    ignores: [
      'node_modules/**',
      'dist/**',
      '.vercel/**',
      'coverage/**',
      'prime-audit.zip',
    ],
  },

  // ── Server: Vercel serverless functions + shared libs ──────────────────────
  {
    files: ['api/**/*.js', 'scripts/**/*.mjs', 'hooks/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      ...js.configs.recommended.rules,
      // An unused arg is usually a signature contract, not a defect. An unused
      // LOCAL is usually a half-finished edit — that one we want.
      'no-unused-vars': ['error', {
        args: 'none',
        caughtErrors: 'none',
        ignoreRestSiblings: true,   // `const { drop, ...rest } = obj` is an omit idiom, not dead code
        varsIgnorePattern: '^_',
      }],
      // `catch {}` with no binding is an established pattern here (chat.js
      // parseActionBlock). Empty blocks elsewhere are still flagged.
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-prototype-builtins': 'error',
    },
  },

  // ── Client: React dashboard + src ─────────────────────────────────────────
  {
    files: ['src/**/*.{js,jsx}', 'marketing-bot-dashboard.jsx'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser },
    },
    plugins: { react },
    settings: { react: { version: 'detect' } },
    rules: {
      ...js.configs.recommended.rules,
      // WITHOUT THESE TWO, no-unused-vars reports every JSX component as unused:
      // core ESLint does not know that <Foo /> is a reference to `Foo`. That is a
      // false-positive flood, and a gate that cries wolf gets ignored — the same
      // failure mode as a gate that stays silent.
      'react/jsx-uses-vars': 'error',
      'react/jsx-uses-react': 'error',
      'no-unused-vars': ['error', {
        args: 'none',
        caughtErrors: 'none',
        ignoreRestSiblings: true,   // `const { drop, ...rest } = obj` is an omit idiom, not dead code
        varsIgnorePattern: '^_|^React$',
      }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },

  // ── Tests: vitest globals ─────────────────────────────────────────────────
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['error', {
        args: 'none',
        caughtErrors: 'none',
        ignoreRestSiblings: true,   // `const { drop, ...rest } = obj` is an omit idiom, not dead code
        varsIgnorePattern: '^_',
      }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },

  // ── Config files at the root ──────────────────────────────────────────────
  {
    files: ['*.config.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: { ...js.configs.recommended.rules },
  },
];

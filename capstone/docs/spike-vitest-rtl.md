# SPIKE — vitest + React Testing Library in `ui/` (T-2-2)

Change: `capstone-ui` · Project: `temporada-1` · Date: 2026-09-22 · Status: ✅ CONCLUDED (design flag d — not skipped)

## Goal

First-ever vitest + RTL component test in this repo: prove jsdom env + @testing-library/react + user-event + React 19 (with `babel-plugin-react-compiler` active through `@vitejs/plugin-react` babel config) work together — including RTL's `act` integration — BEFORE any page/component test is written (task T-2-2 gates T-2-3+).

## Working config (kept — this is the reference for every later iteration)

- `ui/vite.config.ts`: `import { defineConfig } from 'vitest/config'` (test typing); `test: { environment: 'jsdom', setupFiles: ['./tests/setup.ts'], include: ['tests/**/*.test.{ts,tsx}'] }`.
- `ui/tests/setup.ts`: jest-dom matchers + **explicit RTL cleanup** (finding 1 below).
- Versions (2026-09-22): vitest 5.0.1, vite 6.4.3, @vitejs/plugin-react 4.7.0 (the 6.x line requires vite 8 — pinned 4.x for vite 6), babel-plugin-react-compiler 1.0.0, @testing-library/react 16.3.3, @testing-library/user-event 14.6.7, @testing-library/jest-dom 7.0.1, jsdom 30.1.1, React 19.3.0, TypeScript ~5.9.0.
- React Compiler runs in the vitest transform pipeline too (vitest reuses the Vite plugin pipeline — the babel compiler plugin processes test files as well; the spike confirms no interference with RTL/user-event).

## Findings (real failures observed, both fixed in the kept config)

1. **RTL auto-cleanup does NOT register with vitest `globals: false`** — first spike run failed with `Found multiple elements with the role "button"` in the second test: the first test's rendered DOM leaked because @testing-library/react only auto-registers `afterEach(cleanup)` when a global `afterEach` exists. Fix (kept): `afterEach(() => cleanup())` in `tests/setup.ts`. Alternative: set `globals: true` in vitest config — rejected (explicit imports preferred; setup file is the single place).
2. **npm 11 `allowScripts` gating** — `esbuild` postinstall was skipped at `npm install` (binary missing → vitest/vite would fail); fixed with `npm install-scripts approve esbuild && npm rebuild esbuild` at the workspace root. New machines/CI need this or `npm config set allow-scripts` handling. (CI at it6: `npm ci` on a fresh runner — the gating is a local npm 11 default; documented here for the Docker/CI steps at it6.)
3. React 19 + user-event 14 `dblClick` batches two clicks through `act` without warnings — no `act` environment flag needed.

## Evidence (scratch test — REMOVED after documenting, per T-2-2)

Scratch file `tests/spike-vitest-rtl.test.tsx` (counter component, 2 tests):
- `SPIKE: renders and reacts to user-event clicks through React act` — PASS
- `SPIKE: handles rapid double-click (act batching) without warnings` — PASS (after finding 1 fix)
- `vitest run`: 2 passed, 0 failed.

Scratch file deleted; the permanent suite (i18n, api client, harness contract) builds on this config.

## Env resolution (design open question, §10)

`environment: 'jsdom'` set GLOBALLY in `vite.config.ts` (not per-file annotations) — pure-unit files run fine in jsdom; keeps every future test file uniform. Resolved at apply.
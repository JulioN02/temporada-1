import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

/**
 * BOP v1 — UI workspace (capstone-ui it2a, T-2-1). React 19 + Vite 6 +
 * React Compiler (babel-plugin-react-compiler through @vitejs/plugin-react).
 * Dev proxy: /api → :3000 (same-origin strategy — no CORS, cookies flow;
 * prod: express serves ui/dist with the SPA fallback, R-BE-5).
 *
 * vitest config lives here (design §2 / ADR-8): jsdom environment,
 * jest-dom setup file. This is the FIRST vitest setup in the repo — the
 * spike outcome is documented in docs/spike-vitest-rtl.md (T-2-2).
 */
export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [['babel-plugin-react-compiler', { target: '19' }]],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    // Batch C infra note: the default 5000ms per-test timeout flakes on slow
    // dev machines under parallel file execution (pre-existing at it2 — the
    // suite is 84/84 serial). Raised to keep `npm test -w ui` deterministic.
    testTimeout: 15000,
    // it6 (T-6-5) flake mitigation: run test FILES serially. Every batch since
    // it2 has been 100% green SERIALLY; the intermittent parallel timeouts are
    // infra (slow machine), not test failures (documented deviations #19/#27).
    // Serial makes the cumulative gate deterministic in CI and locally.
    fileParallelism: false,
  },
})
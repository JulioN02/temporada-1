/**
 * vitest setup (capstone-ui it2a, T-2-2 spike finding):
 * - jest-dom matchers via module augmentation (works without `globals: true`)
 * - RTL auto-cleanup does NOT register itself when vitest `globals: false`
 *   (RTL detects a global `afterEach`; without it, rendered DOM leaks between
 *   tests — first spike failure "Found multiple elements"). Register cleanup
 *   explicitly — documented in docs/spike-vitest-rtl.md.
 */
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
})
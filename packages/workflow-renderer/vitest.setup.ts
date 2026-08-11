/**
 * jest-dom only registers DOM matchers (`toHaveStyle`, `toHaveClass`, …), so it is
 * dead weight outside a DOM environment. This package's mount tests opt into jsdom
 * per file, so load it only when one is actually running — mirroring `apps/sim`.
 */
if (typeof document !== 'undefined') {
  await import('@testing-library/jest-dom/vitest')
}

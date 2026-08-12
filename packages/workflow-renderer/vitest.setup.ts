/**
 * jest-dom only registers DOM matchers (`toHaveStyle`, `toHaveClass`, …), so it is
 * dead weight outside a DOM environment. This package's mount tests opt into jsdom
 * per file, so load it only when one is actually running — mirroring `apps/sim`.
 */
if (typeof document !== 'undefined') {
  await import('@testing-library/jest-dom/vitest')
  /*
   * React only treats `act` as supported when it can see this flag, and without
   * it every render in the mount tests logs "The current testing environment is
   * not configured to support act(...)". The warning is noise here — the tests
   * already wrap their renders — but it buries real output, and React does not
   * flush effects the way the tests assume until the flag is set.
   */
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
}

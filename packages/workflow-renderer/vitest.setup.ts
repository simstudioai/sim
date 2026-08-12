declare global {
  /**
   * React reads this to decide whether `act` is supported. It is not one of the
   * ambient globals, so it has to be declared before it can be assigned.
   */
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

/**
 * jest-dom only registers DOM matchers (`toHaveStyle`, `toHaveClass`, …), so it is
 * dead weight outside a DOM environment. This package's mount tests opt into jsdom
 * per file, so load it only when one is actually running — mirroring `apps/sim`.
 */
if (typeof document !== 'undefined') {
  await import('@testing-library/jest-dom/vitest')
  /*
   * Without this React treats `act` as unsupported, and every render in the
   * mount tests logs "The current testing environment is not configured to
   * support act(...)" — around forty lines a run, which buries the output that
   * matters when one of them fails.
   */
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
}

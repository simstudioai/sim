/**
 * Local copies of the shared helpers.
 *
 * `@sim/utils` is a private workspace package, so the published `sim` package
 * cannot depend on it — importing it would resolve in the monorepo and fail for
 * anyone installing from npm.
 */

/** Resolves after `ms` milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

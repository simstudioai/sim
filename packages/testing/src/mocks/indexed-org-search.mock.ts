/**
 * The `vi.mock` factory a real-infrastructure suite of indexed organization search passes for
 * `@/lib/core/config/env-flags`: the real module, with Live Search off so the dormant indexed
 * backend is the one selected. Unit suites use the shared env-flags mock's `setEnvFlags` instead.
 *
 * Loaded inside the factory, which runs before the test file's own imports are initialized.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/core/config/env-flags', async (importOriginal) =>
 *   (await import('@sim/testing/mocks/indexed-org-search.mock')).indexedOrgSearchEnvFlags(importOriginal)
 * )
 * ```
 */
export async function indexedOrgSearchEnvFlags(
  importOriginal: <T = unknown>() => Promise<T>
): Promise<Record<string, unknown>> {
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    isLiveEnterpriseSearchEnabled: false,
  }
}

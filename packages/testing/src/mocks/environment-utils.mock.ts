import { vi } from 'vitest'

function emptyPersonalAndWorkspaceEnv(): {
  personalEncrypted: Record<string, string>
  workspaceEncrypted: Record<string, string>
  personalDecrypted: Record<string, string>
  workspaceDecrypted: Record<string, string>
  conflicts: string[]
  decryptionFailures: string[]
} {
  return {
    personalEncrypted: {},
    workspaceEncrypted: {},
    personalDecrypted: {},
    workspaceDecrypted: {},
    conflicts: [],
    decryptionFailures: [],
  }
}

/**
 * Controllable mock functions for `@/lib/environment/utils`. Defaults model a
 * user/workspace with no environment variables. Override per-test and restore
 * with {@link resetEnvironmentUtilsMock}.
 *
 * @example
 * ```ts
 * import { environmentUtilsMockFns } from '@sim/testing'
 *
 * environmentUtilsMockFns.mockGetEffectiveDecryptedEnv.mockResolvedValue({ API_KEY: 'k' })
 * ```
 */
export const environmentUtilsMockFns = {
  mockInvalidateEffectiveDecryptedEnvCache: vi.fn(),
  mockGetEnvironmentVariableKeys: vi.fn().mockResolvedValue({ variableNames: [], count: 0 }),
  mockGetPersonalAndWorkspaceEnv: vi
    .fn()
    .mockImplementation(async () => emptyPersonalAndWorkspaceEnv()),
  mockUpsertPersonalEnvVars: vi.fn().mockResolvedValue({ added: [], updated: [] }),
  mockUpsertWorkspaceEnvVars: vi.fn().mockResolvedValue([]),
  mockGetEffectiveDecryptedEnv: vi.fn().mockResolvedValue({}),
}

/**
 * Restores every environment-utils mock function to its default behavior.
 */
export function resetEnvironmentUtilsMock(): void {
  environmentUtilsMockFns.mockInvalidateEffectiveDecryptedEnvCache.mockReset()
  environmentUtilsMockFns.mockGetEnvironmentVariableKeys
    .mockReset()
    .mockResolvedValue({ variableNames: [], count: 0 })
  environmentUtilsMockFns.mockGetPersonalAndWorkspaceEnv
    .mockReset()
    .mockImplementation(async () => emptyPersonalAndWorkspaceEnv())
  environmentUtilsMockFns.mockUpsertPersonalEnvVars
    .mockReset()
    .mockResolvedValue({ added: [], updated: [] })
  environmentUtilsMockFns.mockUpsertWorkspaceEnvVars.mockReset().mockResolvedValue([])
  environmentUtilsMockFns.mockGetEffectiveDecryptedEnv.mockReset().mockResolvedValue({})
}

/**
 * Complete mock module for `@/lib/environment/utils`, installed globally in
 * `apps/sim/vitest.setup.ts`. Every export of the real module is present.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/environment/utils', () => environmentUtilsMock)
 * ```
 */
export const environmentUtilsMock = {
  invalidateEffectiveDecryptedEnvCache:
    environmentUtilsMockFns.mockInvalidateEffectiveDecryptedEnvCache,
  getEnvironmentVariableKeys: environmentUtilsMockFns.mockGetEnvironmentVariableKeys,
  getPersonalAndWorkspaceEnv: environmentUtilsMockFns.mockGetPersonalAndWorkspaceEnv,
  upsertPersonalEnvVars: environmentUtilsMockFns.mockUpsertPersonalEnvVars,
  upsertWorkspaceEnvVars: environmentUtilsMockFns.mockUpsertWorkspaceEnvVars,
  getEffectiveDecryptedEnv: environmentUtilsMockFns.mockGetEffectiveDecryptedEnv,
}

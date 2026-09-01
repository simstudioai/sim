import { vi } from 'vitest'

/**
 * Every field of the real `EnvironmentResolutionSnapshot`, including the two a
 * caller reads as arrays/records rather than testing for presence. Omitting them
 * let a mocked snapshot reach production code as `undefined` and fail there
 * instead of in the assertion, which is the opposite of what a default should do.
 */
function emptyPersonalAndWorkspaceEnv(): {
  personalEncrypted: Record<string, string>
  workspaceEncrypted: Record<string, string>
  personalDecrypted: Record<string, string>
  workspaceDecrypted: Record<string, string>
  personalOwners: Record<string, string>
  conflicts: string[]
  decryptionFailures: string[]
  workspaceUnredactedKeys: string[]
} {
  return {
    personalEncrypted: {},
    workspaceEncrypted: {},
    personalDecrypted: {},
    workspaceDecrypted: {},
    personalOwners: {},
    conflicts: [],
    decryptionFailures: [],
    workspaceUnredactedKeys: [],
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
/**
 * Mirrors the real resolver: one lookup when both identities match, two when the
 * execution actor differs from the identity owning the personal variables.
 * Delegating keeps `mockGetPersonalAndWorkspaceEnv` the single place a test has
 * to stub environment data.
 */
async function delegateExecutionEnvironment(
  personalUserId: string | undefined,
  workspaceUserId: string,
  workspaceId?: string
) {
  const resolve = environmentUtilsMockFns.mockGetPersonalAndWorkspaceEnv
  if (personalUserId === undefined) {
    const workspaceOnly = await resolve(workspaceUserId, workspaceId)
    return {
      ...workspaceOnly,
      personalEncrypted: {},
      personalDecrypted: {},
      personalOwners: {},
      conflicts: [],
      decryptionFailures: (workspaceOnly.decryptionFailures ?? []).filter(
        (k: string) => k in (workspaceOnly.workspaceEncrypted ?? {})
      ),
    }
  }

  if (!workspaceId || workspaceUserId === personalUserId) {
    return resolve(personalUserId, workspaceId)
  }

  const [personal, actor] = await Promise.all([
    resolve(personalUserId, workspaceId),
    resolve(workspaceUserId, workspaceId),
  ])
  const personalEncrypted = personal.personalEncrypted ?? {}
  const workspaceEncrypted = actor.workspaceEncrypted ?? {}
  return {
    ...personal,
    workspaceEncrypted: actor.workspaceEncrypted,
    workspaceDecrypted: actor.workspaceDecrypted,
    conflicts: Object.keys(personalEncrypted).filter((key) => key in workspaceEncrypted),
    decryptionFailures: [
      ...new Set([
        ...(personal.decryptionFailures ?? []).filter((k: string) => k in personalEncrypted),
        ...(actor.decryptionFailures ?? []).filter((k: string) => k in workspaceEncrypted),
      ]),
    ],
    // Belongs to the workspace slice, so it comes from the actor. Spreading
    // `personal` alone carried the wrong identity's keys — and `undefined` when
    // the stub omitted them.
    workspaceUnredactedKeys: actor.workspaceUnredactedKeys,
  }
}

export const environmentUtilsMockFns = {
  mockInvalidateEffectiveDecryptedEnvCache: vi.fn(),
  mockGetEnvironmentVariableKeys: vi.fn().mockResolvedValue({ variableNames: [], count: 0 }),
  mockGetPersonalAndWorkspaceEnv: vi
    .fn()
    .mockImplementation(async () => emptyPersonalAndWorkspaceEnv()),
  mockGetExecutionEnvironment: vi.fn().mockImplementation(delegateExecutionEnvironment),
  mockGetEffectiveEnvironmentSnapshot: vi
    .fn()
    .mockImplementation(async () => emptyPersonalAndWorkspaceEnv()),
  mockGetEffectiveEnvironmentVariableNames: vi.fn().mockResolvedValue([]),
  mockResolveEffectiveEnvironmentVariables: vi.fn().mockResolvedValue({}),
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
  environmentUtilsMockFns.mockGetExecutionEnvironment
    .mockReset()
    .mockImplementation(delegateExecutionEnvironment)
  environmentUtilsMockFns.mockGetEffectiveEnvironmentSnapshot
    .mockReset()
    .mockImplementation(async () => emptyPersonalAndWorkspaceEnv())
  environmentUtilsMockFns.mockGetEffectiveEnvironmentVariableNames.mockReset().mockResolvedValue([])
  environmentUtilsMockFns.mockResolveEffectiveEnvironmentVariables.mockReset().mockResolvedValue({})
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
  getExecutionEnvironment: environmentUtilsMockFns.mockGetExecutionEnvironment,
  getEffectiveEnvironmentSnapshot: environmentUtilsMockFns.mockGetEffectiveEnvironmentSnapshot,
  getEffectiveEnvironmentVariableNames:
    environmentUtilsMockFns.mockGetEffectiveEnvironmentVariableNames,
  resolveEffectiveEnvironmentVariables:
    environmentUtilsMockFns.mockResolveEffectiveEnvironmentVariables,
  upsertPersonalEnvVars: environmentUtilsMockFns.mockUpsertPersonalEnvVars,
  upsertWorkspaceEnvVars: environmentUtilsMockFns.mockUpsertWorkspaceEnvVars,
  getEffectiveDecryptedEnv: environmentUtilsMockFns.mockGetEffectiveDecryptedEnv,
}

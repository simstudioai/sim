/**
 * @vitest-environment node
 */
import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeatureFlagContext, FeatureFlagName } from '@/lib/core/config/feature-flags'

const { mockFetch, mockIsPlatformAdmin, envRef } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockIsPlatformAdmin: vi.fn(),
  envRef: {
    APPCONFIG_APPLICATION: 'sim-staging' as string | undefined,
    APPCONFIG_ENVIRONMENT: 'staging' as string | undefined,
    TABLES_V2_API: undefined as boolean | undefined,
    TABLE_ROW_TTL: undefined as boolean | undefined,
    CREDENTIAL_GROUPS: undefined as boolean | undefined,
    KNOWLEDGE_MEMBER_ACCESS: undefined as boolean | undefined,
  },
}))

vi.mock('@/lib/core/config/appconfig', () => ({
  fetchAppConfigProfile: mockFetch,
}))

vi.mock('@/lib/core/config/env', () => ({
  isTruthy: (v: unknown) => Boolean(v),
  get env() {
    return envRef
  },
}))

vi.mock('@/lib/permissions/super-user', () => ({
  isPlatformAdmin: mockIsPlatformAdmin,
}))

/**
 * Query-suffixed import gives this file a private instance of the module under
 * test. Under `isolate: false` the worker's module graph is shared across test
 * files, so the plain specifier may already be cached with the real
 * appconfig/env/env-flags bindings (mocks never reach an already-evaluated
 * module) — and evaluating it here under this file's mocks would poison it for
 * later files. The suffixed id is unique to this file, so it always evaluates
 * fresh with the mocks above.
 */
declare module '@/lib/core/config/feature-flags?feature-flags-test' {
  // biome-ignore lint/suspicious/noExportsInTest: ambient type re-declaration for the query-suffixed specifier, not a runtime export
  export * from '@/lib/core/config/feature-flags'
}

import {
  getFeatureFlags,
  isFeatureEnabled,
} from '@/lib/core/config/feature-flags?feature-flags-test'

/** Make `getFeatureFlags` resolve to `doc` via the AppConfig path (also exercises parseConfig). */
function withAppConfig(doc: unknown) {
  setEnvFlags({ isAppConfigEnabled: true })
  mockFetch.mockImplementation((_ids, parse) => Promise.resolve(parse(doc)))
}

/**
 * `isFeatureEnabled` only accepts registered `FeatureFlagName`s. These tests
 * exercise the evaluation logic with throwaway flag names supplied through the
 * AppConfig document, cast to `FeatureFlagName` through this helper.
 */
const enabled = (flag: string, ctx?: FeatureFlagContext) =>
  isFeatureEnabled(flag as FeatureFlagName, ctx)

afterAll(resetEnvFlagsMock)

describe('getFeatureFlags', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setEnvFlags({ isAppConfigEnabled: false })
  })

  it('derives flags from fallback secrets when AppConfig is disabled, without fetching', async () => {
    const flags = await getFeatureFlags()
    // All registered flags should be present, disabled (env vars unset in test env)
    expect(flags['trigger-eu-region']).toEqual({ enabled: false })
    expect(flags['tables-v2-api']).toEqual({ enabled: false })
    expect(flags['table-row-ttl']).toEqual({ enabled: false })
    expect(flags['credential-groups']).toEqual({ enabled: false })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('reads the feature-flags profile and normalizes the payload when enabled', async () => {
    withAppConfig({
      a: { enabled: true },
      b: { orgIds: ['Org_1', ' org_1 ', '', 'org_2'], userIds: 'nope' },
      c: 'not-an-object',
    })

    const flags = await getFeatureFlags()
    expect(flags.a).toEqual({ enabled: true })
    expect(flags.b).toEqual({ orgIds: ['Org_1', 'org_1', 'org_2'] })
    expect(flags.c).toBeUndefined()
    expect(mockFetch).toHaveBeenCalledWith(
      { application: 'sim-staging', environment: 'staging', profile: 'feature-flags' },
      expect.any(Function)
    )
  })

  it('falls back to the secret-derived document when the fetch yields null', async () => {
    setEnvFlags({ isAppConfigEnabled: true })
    mockFetch.mockResolvedValue(null)
    const flags = await getFeatureFlags()
    expect(flags['trigger-eu-region']).toEqual({ enabled: false })
    expect(flags['tables-v2-api']).toEqual({ enabled: false })
    expect(flags['table-row-ttl']).toEqual({ enabled: false })
    expect(flags['credential-groups']).toEqual({ enabled: false })
  })

  it('degrades gracefully on a malformed document', async () => {
    withAppConfig('not-an-object')
    expect(await getFeatureFlags()).toMatchObject({})
    withAppConfig(null)
    expect(await getFeatureFlags()).toMatchObject({})
  })
})

describe('isFeatureEnabled', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setEnvFlags({ isAppConfigEnabled: false })
    envRef.CREDENTIAL_GROUPS = undefined
    envRef.KNOWLEDGE_MEMBER_ACCESS = undefined
  })

  describe('knowledge-member-access flag', () => {
    it('uses a global fallback switch off AppConfig', async () => {
      expect(await isFeatureEnabled('knowledge-member-access')).toBe(false)

      envRef.KNOWLEDGE_MEMBER_ACCESS = true
      expect(await isFeatureEnabled('knowledge-member-access')).toBe(true)
    })

    it('opens for an allowlisted workspace only', async () => {
      withAppConfig({ 'knowledge-member-access': { workspaceIds: ['ws-1'] } })
      expect(
        await isFeatureEnabled('knowledge-member-access', { workspaceId: 'ws-1', userId: 'u1' })
      ).toBe(true)
      expect(
        await isFeatureEnabled('knowledge-member-access', { workspaceId: 'ws-2', userId: 'u1' })
      ).toBe(false)
      expect(mockIsPlatformAdmin).not.toHaveBeenCalled()
    })

    it('opens for a platform admin in any workspace', async () => {
      withAppConfig({ 'knowledge-member-access': { workspaceIds: ['ws-1'], adminEnabled: true } })
      mockIsPlatformAdmin.mockResolvedValue(true)
      expect(
        await isFeatureEnabled('knowledge-member-access', { workspaceId: 'ws-2', userId: 'admin' })
      ).toBe(true)
      mockIsPlatformAdmin.mockResolvedValue(false)
      expect(
        await isFeatureEnabled('knowledge-member-access', { workspaceId: 'ws-2', userId: 'u1' })
      ).toBe(false)
      expect(await isFeatureEnabled('knowledge-member-access', { workspaceId: 'ws-2' })).toBe(false)
    })
  })

  describe('credential-groups flag', () => {
    it('uses a global fallback switch off AppConfig', async () => {
      expect(await isFeatureEnabled('credential-groups')).toBe(false)

      envRef.CREDENTIAL_GROUPS = true
      expect(await isFeatureEnabled('credential-groups')).toBe(true)
    })

    it('uses the global AppConfig clause', async () => {
      withAppConfig({ 'credential-groups': { enabled: true } })
      expect(await isFeatureEnabled('credential-groups')).toBe(true)
    })

    it('opens for an allowlisted workspace only', async () => {
      withAppConfig({ 'credential-groups': { workspaceIds: ['ws-1'] } })
      expect(await isFeatureEnabled('credential-groups', { workspaceId: 'ws-1' })).toBe(true)
      expect(await isFeatureEnabled('credential-groups', { workspaceId: 'ws-2' })).toBe(false)
      expect(await isFeatureEnabled('credential-groups')).toBe(false)
    })
  })

  it('matches the workspaceIds clause', async () => {
    withAppConfig({ f: { workspaceIds: ['ws-1'] } })
    expect(await enabled('f', { workspaceId: 'ws-1' })).toBe(true)
    expect(await enabled('f', { workspaceId: 'ws-2' })).toBe(false)
    expect(await enabled('f', { userId: 'ws-1' })).toBe(false)
  })

  it('returns false for an unknown flag', async () => {
    withAppConfig({})
    expect(await enabled('missing', { userId: 'u1' })).toBe(false)
  })

  it('matches the global enabled clause', async () => {
    withAppConfig({ f: { enabled: true } })
    expect(await enabled('f')).toBe(true)
  })

  it('matches the userId allowlist', async () => {
    withAppConfig({ f: { userIds: ['u1'] } })
    expect(await enabled('f', { userId: 'u1' })).toBe(true)
    expect(await enabled('f', { userId: 'u2' })).toBe(false)
    expect(await enabled('f', {})).toBe(false)
  })

  it('matches the orgId allowlist', async () => {
    withAppConfig({ f: { orgIds: ['o1'] } })
    expect(await enabled('f', { orgId: 'o1' })).toBe(true)
    expect(await enabled('f', { orgId: 'o2' })).toBe(false)
  })

  describe('admin clause (lazy resolution)', () => {
    it('resolves admin from userId when adminEnabled is the deciding clause', async () => {
      withAppConfig({ f: { adminEnabled: true } })
      mockIsPlatformAdmin.mockResolvedValue(true)
      expect(await enabled('f', { userId: 'u1' })).toBe(true)
      expect(mockIsPlatformAdmin).toHaveBeenCalledWith('u1')

      mockIsPlatformAdmin.mockResolvedValue(false)
      expect(await enabled('f', { userId: 'u2' })).toBe(false)
    })

    it('uses the isAdmin override without querying', async () => {
      withAppConfig({ f: { adminEnabled: true } })
      expect(await enabled('f', { userId: 'u1', isAdmin: true })).toBe(true)
      expect(mockIsPlatformAdmin).not.toHaveBeenCalled()
    })

    it('resolves to false without querying when userId is absent', async () => {
      withAppConfig({ f: { adminEnabled: true } })
      expect(await enabled('f', { orgId: 'o1' })).toBe(false)
      expect(mockIsPlatformAdmin).not.toHaveBeenCalled()
    })

    it('does not query when an earlier clause already matched', async () => {
      withAppConfig({ f: { enabled: true, adminEnabled: true } })
      expect(await enabled('f', { userId: 'u1' })).toBe(true)

      withAppConfig({ g: { userIds: ['u1'], adminEnabled: true } })
      expect(await enabled('g', { userId: 'u1' })).toBe(true)
      expect(mockIsPlatformAdmin).not.toHaveBeenCalled()
    })

    it('does not query when the rule has no adminEnabled clause', async () => {
      withAppConfig({ f: { userIds: ['u2'] } })
      expect(await enabled('f', { userId: 'u1' })).toBe(false)
      expect(mockIsPlatformAdmin).not.toHaveBeenCalled()
    })
  })
})

describe('tables-v2-api flag', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setEnvFlags({ isAppConfigEnabled: false })
    envRef.TABLES_V2_API = undefined
  })

  it('is off by default off-AppConfig, on when the fallback secret is set', async () => {
    expect(await isFeatureEnabled('tables-v2-api')).toBe(false)
    envRef.TABLES_V2_API = true
    expect(await isFeatureEnabled('tables-v2-api')).toBe(true)
  })

  it('gates by org cohort via AppConfig', async () => {
    withAppConfig({ 'tables-v2-api': { orgIds: ['org-1'] } })
    expect(await isFeatureEnabled('tables-v2-api', { orgId: 'org-1' })).toBe(true)
    expect(await isFeatureEnabled('tables-v2-api', { orgId: 'org-2' })).toBe(false)
    expect(await isFeatureEnabled('tables-v2-api', { userId: 'u1' })).toBe(false)
  })

  it('global enabled turns it on for everyone', async () => {
    withAppConfig({ 'tables-v2-api': { enabled: true } })
    expect(await isFeatureEnabled('tables-v2-api')).toBe(true)
  })
})

describe('table-row-ttl flag', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setEnvFlags({ isAppConfigEnabled: false })
    envRef.TABLE_ROW_TTL = undefined
  })

  it('uses a global fallback switch off AppConfig', async () => {
    expect(await isFeatureEnabled('table-row-ttl')).toBe(false)

    envRef.TABLE_ROW_TTL = true
    expect(await isFeatureEnabled('table-row-ttl')).toBe(true)
  })

  it('uses the global AppConfig clause', async () => {
    withAppConfig({ 'table-row-ttl': { enabled: true } })
    expect(await isFeatureEnabled('table-row-ttl')).toBe(true)
  })
})

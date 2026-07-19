/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFetch, mockIsPlatformAdmin, envRef, flagRef } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockIsPlatformAdmin: vi.fn(),
  envRef: {
    APPCONFIG_APPLICATION: 'sim-staging' as string | undefined,
    APPCONFIG_ENVIRONMENT: 'staging' as string | undefined,
  },
  flagRef: { isAppConfigEnabled: false, previewBlocks: [] as string[] },
}))

vi.mock('@/lib/core/config/appconfig', () => ({
  fetchAppConfigProfile: mockFetch,
}))

vi.mock('@/lib/core/config/env', () => ({
  get env() {
    return envRef
  },
}))

vi.mock('@/lib/core/config/env-flags', () => ({
  get isAppConfigEnabled() {
    return flagRef.isAppConfigEnabled
  },
  getPreviewBlocksFromEnv: () => flagRef.previewBlocks,
}))

vi.mock('@/lib/permissions/super-user', () => ({
  isPlatformAdmin: mockIsPlatformAdmin,
}))

import { getBlockVisibility } from '@/lib/core/config/block-visibility'

/** Make `getBlockVisibility` resolve `doc` via the AppConfig path (also exercises parsing). */
function withAppConfig(doc: unknown) {
  flagRef.isAppConfigEnabled = true
  mockFetch.mockImplementation((_ids, parse) => Promise.resolve(parse(doc)))
}

describe('getBlockVisibility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    flagRef.isAppConfigEnabled = false
    flagRef.previewBlocks = []
  })

  describe('off-AppConfig (env fallback)', () => {
    it('reveals and preview-tags the PREVIEW_BLOCKS types without fetching', async () => {
      flagRef.previewBlocks = ['gmail_v2', 'notion_v3']
      const vis = await getBlockVisibility({ userId: 'u1' })
      expect(vis.revealed).toEqual(new Set(['gmail_v2', 'notion_v3']))
      expect(vis.previewTagged).toEqual(new Set(['gmail_v2', 'notion_v3']))
      expect(vis.disabled.size).toBe(0)
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('returns empty state when PREVIEW_BLOCKS is unset', async () => {
      const vis = await getBlockVisibility()
      expect(vis.revealed.size).toBe(0)
      expect(vis.disabled.size).toBe(0)
      expect(vis.previewTagged.size).toBe(0)
    })
  })

  it('fetches the block-visibility profile', async () => {
    withAppConfig({})
    await getBlockVisibility()
    expect(mockFetch).toHaveBeenCalledWith(
      { application: 'sim-staging', environment: 'staging', profile: 'block-visibility' },
      expect.any(Function)
    )
  })

  it('GA rule (enabled: true) reveals without a preview tag', async () => {
    withAppConfig({ gmail_v2: { enabled: true } })
    const vis = await getBlockVisibility({ userId: 'u1' })
    expect(vis.revealed.has('gmail_v2')).toBe(true)
    expect(vis.previewTagged.has('gmail_v2')).toBe(false)
    expect(vis.disabled.has('gmail_v2')).toBe(false)
  })

  it('allowlist rule reveals with a preview tag; non-matching viewers get disabled', async () => {
    withAppConfig({ gmail_v2: { enabled: false, orgIds: ['o1'], userIds: ['u9'] } })

    const allowedOrg = await getBlockVisibility({ orgId: 'o1' })
    expect(allowedOrg.revealed.has('gmail_v2')).toBe(true)
    expect(allowedOrg.previewTagged.has('gmail_v2')).toBe(true)

    const allowedUser = await getBlockVisibility({ userId: 'u9' })
    expect(allowedUser.revealed.has('gmail_v2')).toBe(true)

    const denied = await getBlockVisibility({ userId: 'u1', orgId: 'o2' })
    expect(denied.revealed.has('gmail_v2')).toBe(false)
    expect(denied.disabled.has('gmail_v2')).toBe(true)
  })

  it('kill switch (enabled: false, no allowlists) disables for everyone', async () => {
    withAppConfig({ slack: { enabled: false } })
    const vis = await getBlockVisibility({ userId: 'u1', orgId: 'o1' })
    expect(vis.disabled.has('slack')).toBe(true)
    expect(vis.revealed.has('slack')).toBe(false)
  })

  it('drops custom_block_* keys so custom blocks can never be gated', async () => {
    withAppConfig({ custom_block_abc123: { enabled: false }, gmail_v2: { enabled: true } })
    const vis = await getBlockVisibility({ userId: 'u1' })
    expect(vis.disabled.has('custom_block_abc123')).toBe(false)
    expect(vis.revealed.has('custom_block_abc123')).toBe(false)
    expect(vis.revealed.has('gmail_v2')).toBe(true)
  })

  it('drops malformed entries', async () => {
    withAppConfig({ a: 'nope', b: { enabled: false, orgIds: [' o1 ', ''] } })
    const vis = await getBlockVisibility({ orgId: 'o1' })
    expect(vis.disabled.has('a')).toBe(false)
    expect(vis.revealed.has('b')).toBe(true)
  })

  describe('admin resolution (once per call)', () => {
    it('resolves admin exactly once for a document with multiple adminEnabled rules', async () => {
      withAppConfig({
        a: { enabled: false, adminEnabled: true },
        b: { enabled: false, adminEnabled: true },
        c: { enabled: false },
      })
      mockIsPlatformAdmin.mockResolvedValue(true)
      const vis = await getBlockVisibility({ userId: 'u1' })
      expect(mockIsPlatformAdmin).toHaveBeenCalledTimes(1)
      expect(vis.revealed).toEqual(new Set(['a', 'b']))
      expect(vis.previewTagged).toEqual(new Set(['a', 'b']))
      expect(vis.disabled).toEqual(new Set(['c']))
    })

    it('uses the isAdmin fast-path without querying', async () => {
      withAppConfig({ a: { enabled: false, adminEnabled: true } })
      const vis = await getBlockVisibility({ userId: 'u1', isAdmin: true })
      expect(vis.revealed.has('a')).toBe(true)
      expect(mockIsPlatformAdmin).not.toHaveBeenCalled()
    })

    it('does not query when no rule has adminEnabled or when userId is absent', async () => {
      withAppConfig({ a: { enabled: false, orgIds: ['o1'] } })
      await getBlockVisibility({ userId: 'u1' })
      expect(mockIsPlatformAdmin).not.toHaveBeenCalled()

      withAppConfig({ a: { enabled: false, adminEnabled: true } })
      const vis = await getBlockVisibility({ orgId: 'o1' })
      expect(vis.disabled.has('a')).toBe(true)
      expect(mockIsPlatformAdmin).not.toHaveBeenCalled()
    })
  })
})

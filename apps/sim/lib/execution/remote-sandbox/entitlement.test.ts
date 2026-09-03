/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRetentionAccess } = vi.hoisted(() => ({
  mockRetentionAccess: vi.fn(),
}))

vi.mock('@/lib/billing/core/subscription', () => ({
  hasWorkspaceSandboxRetentionAccess: mockRetentionAccess,
}))

import { __resetCoalesceLocallyForTests } from '@/lib/concurrency/singleflight'
import {
  hasWorkspaceSandboxRetentionAccessCached,
  MAX_PLAN_REQUIRED,
  resetSandboxEntitlementCache,
} from '@/lib/execution/remote-sandbox/entitlement'

const WORKSPACE_ID = 'workspace-1'

describe('cached sandbox retention entitlement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetSandboxEntitlementCache()
    __resetCoalesceLocallyForTests()
    mockRetentionAccess.mockResolvedValue(true)
  })

  it('names the plan in the message every surface shares', () => {
    expect(MAX_PLAN_REQUIRED).toContain('Max or Enterprise')
  })

  it('serves the execution path from cache instead of re-reading billing', async () => {
    await expect(hasWorkspaceSandboxRetentionAccessCached(WORKSPACE_ID)).resolves.toBe(true)
    await expect(hasWorkspaceSandboxRetentionAccessCached(WORKSPACE_ID)).resolves.toBe(true)
    await expect(hasWorkspaceSandboxRetentionAccessCached(WORKSPACE_ID)).resolves.toBe(true)

    expect(mockRetentionAccess).toHaveBeenCalledTimes(1)
  })

  /**
   * The cached value is a boolean, so a truthiness check would read a cached
   * `false` as a miss — re-querying billing on every Function block for
   * exactly the workspaces the cache exists to protect.
   */
  it('serves a cached false without re-reading billing', async () => {
    mockRetentionAccess.mockResolvedValue(false)

    await expect(hasWorkspaceSandboxRetentionAccessCached(WORKSPACE_ID)).resolves.toBe(false)
    await expect(hasWorkspaceSandboxRetentionAccessCached(WORKSPACE_ID)).resolves.toBe(false)

    expect(mockRetentionAccess).toHaveBeenCalledTimes(1)
  })

  it('collapses concurrent resolutions into one read', async () => {
    let release: (value: boolean) => void = () => {}
    mockRetentionAccess.mockReturnValue(
      new Promise<boolean>((resolve) => {
        release = resolve
      })
    )

    const inflight = Promise.all([
      hasWorkspaceSandboxRetentionAccessCached(WORKSPACE_ID),
      hasWorkspaceSandboxRetentionAccessCached(WORKSPACE_ID),
      hasWorkspaceSandboxRetentionAccessCached(WORKSPACE_ID),
    ])

    release(true)

    await expect(inflight).resolves.toEqual([true, true, true])
    expect(mockRetentionAccess).toHaveBeenCalledTimes(1)
  })

  it('keeps workspaces in separate cache entries', async () => {
    mockRetentionAccess.mockImplementation(async (id: string) => id === WORKSPACE_ID)

    await expect(hasWorkspaceSandboxRetentionAccessCached(WORKSPACE_ID)).resolves.toBe(true)
    await expect(hasWorkspaceSandboxRetentionAccessCached('workspace-2')).resolves.toBe(false)
    await expect(hasWorkspaceSandboxRetentionAccessCached(WORKSPACE_ID)).resolves.toBe(true)

    expect(mockRetentionAccess).toHaveBeenCalledTimes(2)
  })

  /**
   * The rejection path exists because the cached read asks for it. The
   * one-shot gate maps a billing outage to `false` — indistinguishable from a
   * real lapse — and caching that would fail every Function block in the
   * workspace for the full TTL.
   */
  it('asks billing to throw rather than report an outage as a lapse', async () => {
    await hasWorkspaceSandboxRetentionAccessCached(WORKSPACE_ID)

    expect(mockRetentionAccess).toHaveBeenCalledWith(WORKSPACE_ID, { onError: 'throw' })
  })

  it('does not cache a rejection, so a transient failure cannot pin the gate shut', async () => {
    mockRetentionAccess.mockRejectedValueOnce(new Error('billing read failed'))

    await expect(hasWorkspaceSandboxRetentionAccessCached(WORKSPACE_ID)).rejects.toThrow(
      'billing read failed'
    )
    await expect(hasWorkspaceSandboxRetentionAccessCached(WORKSPACE_ID)).resolves.toBe(true)

    expect(mockRetentionAccess).toHaveBeenCalledTimes(2)
  })
})

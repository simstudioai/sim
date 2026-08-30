/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetUserPermissionConfig, mockResolveVerifiedContext } = vi.hoisted(() => ({
  mockGetUserPermissionConfig: vi.fn(),
  mockResolveVerifiedContext: vi.fn(),
}))

vi.mock('react', () => ({ cache: <F>(fn: F) => fn }))

vi.mock('@/ee/access-control/utils/permission-check', () => ({
  getUserPermissionConfig: mockGetUserPermissionConfig,
  resolveVerifiedUserAccessControlContext: mockResolveVerifiedContext,
}))

import {
  resolvePermissionGroupConfig,
  withPermissionGroupScope,
} from '@/lib/permission-groups/config-scope.server'

const CONFIG = { hideTablesTab: true }

describe('resolvePermissionGroupConfig scope memo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUserPermissionConfig.mockResolvedValue(CONFIG)
    mockResolveVerifiedContext.mockResolvedValue({ config: CONFIG })
  })

  /**
   * The key omits `organizationId` because a caller may only pass the
   * organization of the workspace it names, so the two arms resolve the same
   * group. Adding it to the key would split the cache and query twice.
   */
  it('shares one query between the looked-up and the already-loaded form', async () => {
    const [first, second] = await withPermissionGroupScope(() =>
      Promise.all([
        resolvePermissionGroupConfig('user-1', 'workspace-1', undefined),
        resolvePermissionGroupConfig('user-1', 'workspace-1', 'org-1'),
      ])
    )

    expect(first).toBe(second)
    expect(
      mockGetUserPermissionConfig.mock.calls.length + mockResolveVerifiedContext.mock.calls.length
    ).toBe(1)
  })

  it('resolves a different user or workspace separately', async () => {
    await withPermissionGroupScope(async () => {
      await resolvePermissionGroupConfig('user-1', 'workspace-1', 'org-1')
      await resolvePermissionGroupConfig('user-2', 'workspace-1', 'org-1')
      await resolvePermissionGroupConfig('user-1', 'workspace-2', 'org-1')
    })

    expect(mockResolveVerifiedContext).toHaveBeenCalledTimes(3)
  })

  it('still answers outside a scope, without memoizing', async () => {
    await resolvePermissionGroupConfig('user-1', 'workspace-1', 'org-1')
    await resolvePermissionGroupConfig('user-1', 'workspace-1', 'org-1')

    expect(mockResolveVerifiedContext).toHaveBeenCalledTimes(2)
  })
})

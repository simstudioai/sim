import { db } from '@sim/db'
import {
  permissionGroupsResolveMock,
  permissionGroupsResolveMockFns,
} from '@sim/testing/mocks/permission-groups-resolve.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react', () => ({ cache: <F>(fn: F) => fn }))

vi.mock('@/lib/permission-groups/resolve.server', () => permissionGroupsResolveMock)

import { resolvePermissionGroupConfig } from '@/lib/permission-groups/config-scope.server'
import { withPermissionGroupScope } from '@/lib/permission-groups/request-scope.server'

const {
  mockGetUserPermissionConfig,
  mockResolveVerifiedUserAccessControlContext: mockResolveVerifiedContext,
} = permissionGroupsResolveMockFns

const CONFIG = { hideTablesTab: true }

describe('resolvePermissionGroupConfig scope memo', () => {
  beforeEach(() => {
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

  it('bypasses the scope memo for explicit executors without replacing the cached request result', async () => {
    const updated = { ...CONFIG, disablePersonalApiKeys: true }
    await withPermissionGroupScope(async () => {
      expect(await resolvePermissionGroupConfig('user-1', 'workspace-1', 'org-1')).toEqual(CONFIG)
      mockResolveVerifiedContext.mockResolvedValue({ config: updated })
      expect(await resolvePermissionGroupConfig('user-1', 'workspace-1', 'org-1', db)).toEqual(
        updated
      )
      expect(mockResolveVerifiedContext).toHaveBeenLastCalledWith(
        'user-1',
        'workspace-1',
        'org-1',
        db
      )
      expect(await resolvePermissionGroupConfig('user-1', 'workspace-1', 'org-1')).toEqual(CONFIG)
      mockResolveVerifiedContext.mockResolvedValue({ config: null })
      expect(await resolvePermissionGroupConfig('user-1', 'workspace-1', 'org-1', db)).toBeNull()
    })
    expect(mockResolveVerifiedContext).toHaveBeenCalledTimes(3)
  })

  it('forwards an explicit executor when the organization must be loaded', async () => {
    await withPermissionGroupScope(async () => {
      await resolvePermissionGroupConfig('user-1', 'workspace-1', undefined)
      mockGetUserPermissionConfig.mockResolvedValue(null)
      expect(await resolvePermissionGroupConfig('user-1', 'workspace-1', undefined, db)).toBeNull()
    })
    expect(mockGetUserPermissionConfig).toHaveBeenLastCalledWith('user-1', 'workspace-1', db)
  })
})

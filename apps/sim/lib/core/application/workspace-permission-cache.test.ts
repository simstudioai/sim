/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ resolvePermission: vi.fn() }))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: () => true,
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

import { createWorkspacePermissionCache } from '@/lib/core/application/workspace-authorization'

describe('createWorkspacePermissionCache', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolvePermission.mockResolvedValue('write')
  })

  it('queries once for a repeated triple', async () => {
    const cache = createWorkspacePermissionCache()

    const results = await Promise.all([
      cache.resolve('user-1', 'workspace-1', 'organization-1'),
      cache.resolve('user-1', 'workspace-1', 'organization-1'),
      cache.resolve('user-1', 'workspace-1', 'organization-1'),
    ])

    expect(results).toEqual(['write', 'write', 'write'])
    expect(mocks.resolvePermission).toHaveBeenCalledExactlyOnceWith(
      'user-1',
      'workspace-1',
      'organization-1'
    )
  })

  it('keeps a null answer, which is a real verdict rather than a cache miss', async () => {
    mocks.resolvePermission.mockResolvedValue(null)
    const cache = createWorkspacePermissionCache()

    expect(await cache.resolve('user-1', 'workspace-1', null)).toBeNull()
    expect(await cache.resolve('user-1', 'workspace-1', null)).toBeNull()

    expect(mocks.resolvePermission).toHaveBeenCalledTimes(1)
  })

  it('separates entries that differ in any part of the triple', async () => {
    const cache = createWorkspacePermissionCache()

    await cache.resolve('user-1', 'workspace-1', 'organization-1')
    await cache.resolve('user-2', 'workspace-1', 'organization-1')
    await cache.resolve('user-1', 'workspace-2', 'organization-1')
    await cache.resolve('user-1', 'workspace-1', null)

    expect(mocks.resolvePermission).toHaveBeenCalledTimes(4)
  })

  it('does not let a workspace id run into an organization id', async () => {
    // A naive concatenation makes ('u', 'a', 'bc') and ('u', 'ab', 'c') the same entry, which
    // would answer one workspace's authorization question with another's permission row.
    const cache = createWorkspacePermissionCache()

    await cache.resolve('u', 'a', 'bc')
    await cache.resolve('u', 'ab', 'c')

    expect(mocks.resolvePermission).toHaveBeenCalledTimes(2)
  })

  it('re-queries after a rejection instead of caching the failure', async () => {
    mocks.resolvePermission.mockRejectedValueOnce(new Error('connection reset'))
    const cache = createWorkspacePermissionCache()

    await expect(cache.resolve('user-1', 'workspace-1', null)).rejects.toThrow('connection reset')
    expect(await cache.resolve('user-1', 'workspace-1', null)).toBe('write')

    expect(mocks.resolvePermission).toHaveBeenCalledTimes(2)
  })
})

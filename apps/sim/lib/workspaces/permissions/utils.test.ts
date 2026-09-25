import { db } from '@sim/db'
import { describe, expect, it, vi } from 'vitest'
import {
  checkWorkspaceAccess,
  getManageableWorkspaces,
  getUserEntityPermissions,
  getUsersWithPermissions,
  getWorkspaceWithOwner,
  hasWorkspaceAdminAccess,
} from '@/lib/workspaces/permissions/utils'

const mockDb = db as any
type PermissionType = 'admin' | 'write' | 'read'

function createMockChain(finalResult: any) {
  const chain: any = {}

  chain.then = vi.fn().mockImplementation((resolve: any) => resolve(finalResult))
  chain.select = vi.fn().mockReturnValue(chain)
  chain.from = vi.fn().mockReturnValue(chain)
  chain.where = vi.fn().mockReturnValue(chain)
  chain.limit = vi.fn().mockReturnValue(chain)
  chain.innerJoin = vi.fn().mockReturnValue(chain)
  chain.leftJoin = vi.fn().mockReturnValue(chain)
  chain.orderBy = vi.fn().mockReturnValue(chain)

  return chain
}

describe('Permission Utils', () => {
  describe('getUserEntityPermissions', () => {
    it('should return null when user has no permissions', async () => {
      const chain = createMockChain([])
      mockDb.select.mockReturnValue(chain)

      const result = await getUserEntityPermissions('user123', 'workspace', 'workspace456')

      expect(result).toBeNull()
    })

    it('should prioritize admin over other permissions', async () => {
      const mockResults = [
        { permissionType: 'write' as PermissionType },
        { permissionType: 'admin' as PermissionType },
        { permissionType: 'read' as PermissionType },
      ]
      const chain = createMockChain(mockResults)
      mockDb.select.mockReturnValue(chain)

      const result = await getUserEntityPermissions('user999', 'workflow', 'workflow999')

      expect(result).toBe('admin')
    })
  })

  describe('getUsersWithPermissions', () => {
    function mockSelectSequence(results: any[][]) {
      let index = 0
      mockDb.select.mockImplementation(() => createMockChain(results[index++] ?? []))
    }

    const joinedAt = new Date('2026-04-22T00:00:00.000Z')

    it('merges organization admins as derived workspace admins', async () => {
      mockSelectSequence([
        [{ id: 'ws', ownerId: 'owner-user', organizationId: 'org-1' }],
        [
          {
            userId: 'member-user',
            email: 'member@example.com',
            name: 'Member',
            image: null,
            permissionType: 'read' as PermissionType,
            joinedAt,
            userOrganizationId: 'org-1',
          },
        ],
        [
          {
            userId: 'org-admin-user',
            email: 'orgadmin@example.com',
            name: 'Org Admin',
            image: null,
            joinedAt,
          },
        ],
      ])

      const result = await getUsersWithPermissions('ws')
      const orgAdmin = result.find((u) => u.userId === 'org-admin-user')

      expect(orgAdmin).toMatchObject({
        permissionType: 'admin',
        roleSource: 'org-admin',
        isOrgAdmin: true,
        isExternal: false,
      })
    })

    it('marks users as external when they are not members of the workspace organization', async () => {
      mockSelectSequence([
        [{ id: 'ws', ownerId: 'internal-user', organizationId: 'org-1' }],
        [
          {
            userId: 'internal-user',
            email: 'internal@example.com',
            name: 'Internal User',
            image: null,
            permissionType: 'admin' as PermissionType,
            joinedAt,
            userOrganizationId: 'org-1',
          },
          {
            userId: 'external-user',
            email: 'external@example.com',
            name: 'External User',
            image: null,
            permissionType: 'write' as PermissionType,
            joinedAt,
            userOrganizationId: 'org-2',
          },
        ],
        [],
      ])

      const result = await getUsersWithPermissions('ws')
      const byEmail = new Map(result.map((u) => [u.email, u.isExternal]))

      expect(byEmail.get('internal@example.com')).toBe(false)
      expect(byEmail.get('external@example.com')).toBe(true)
    })

    it('marks a non-owner member of another org as external on a personal workspace', async () => {
      mockSelectSequence([
        [{ id: 'ws', ownerId: 'owner-user', organizationId: null }],
        [
          {
            userId: 'owner-user',
            email: 'owner@example.com',
            name: 'Owner',
            image: null,
            permissionType: 'admin' as PermissionType,
            joinedAt,
            userOrganizationId: null,
          },
          {
            userId: 'guest-user',
            email: 'guest@example.com',
            name: 'Guest',
            image: null,
            permissionType: 'write' as PermissionType,
            joinedAt,
            userOrganizationId: 'org-guest',
          },
        ],
      ])

      const result = await getUsersWithPermissions('workspace-personal')
      const byEmail = new Map(result.map((u) => [u.email, u.isExternal]))

      expect(byEmail.get('owner@example.com')).toBe(false)
      expect(byEmail.get('guest@example.com')).toBe(true)
    })
  })

  describe('hasWorkspaceAdminAccess', () => {
    it('should return false when user has no admin access', async () => {
      let callCount = 0
      mockDb.select.mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          return createMockChain([{ ownerId: 'other-user' }])
        }
        return createMockChain([])
      })

      const result = await hasWorkspaceAdminAccess('user123', 'workspace456')

      expect(result).toBe(false)
    })

    it('should return false when user has write permission but not admin', async () => {
      let callCount = 0
      mockDb.select.mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          return createMockChain([{ ownerId: 'other-user' }])
        }
        return createMockChain([])
      })

      const result = await hasWorkspaceAdminAccess('user123', 'workspace456')

      expect(result).toBe(false)
    })
  })

  describe('getManageableWorkspaces', () => {
    it('should combine owned and admin workspaces without duplicates', async () => {
      const mockOwnedWorkspaces = [
        { id: 'ws1', name: 'My Workspace', ownerId: 'user123' },
        { id: 'ws2', name: 'Another Workspace', ownerId: 'user123' },
      ]
      const mockAdminWorkspaces = [
        { id: 'ws1', name: 'My Workspace', ownerId: 'user123' }, // Duplicate (should be filtered)
        { id: 'ws3', name: 'Shared Workspace', ownerId: 'other-user' },
      ]

      let callCount = 0
      mockDb.select.mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          return createMockChain(mockOwnedWorkspaces) // Owned workspaces
        }
        return createMockChain(mockAdminWorkspaces) // Admin workspaces
      })

      const result = await getManageableWorkspaces('user123')

      expect(result).toHaveLength(3)
      expect(result).toEqual([
        { id: 'ws1', name: 'My Workspace', ownerId: 'user123', accessType: 'owner' },
        { id: 'ws2', name: 'Another Workspace', ownerId: 'user123', accessType: 'owner' },
        { id: 'ws3', name: 'Shared Workspace', ownerId: 'other-user', accessType: 'direct' },
      ])
    })
  })

  describe('getWorkspaceWithOwner', () => {
    /**
     * Archived visibility is applied in JS, not SQL, so the read can be shared by the
     * gates that disagree about it. That makes these two the boundary worth pinning:
     * if the filter ever stops matching the old `archived_at IS NULL` predicate, archived
     * workspaces silently become visible to callers that asked not to see them.
     */
    it.concurrent('should hide an archived workspace by default', async () => {
      const chain = createMockChain([
        { id: 'workspace123', ownerId: 'owner456', archivedAt: new Date('2026-01-01') },
      ])
      mockDb.select.mockReturnValue(chain)

      const result = await getWorkspaceWithOwner('workspace123')

      expect(result).toBeNull()
    })

    it.concurrent('should return an archived workspace when asked to include them', async () => {
      const archivedAt = new Date('2026-01-01')
      const chain = createMockChain([{ id: 'workspace123', ownerId: 'owner456', archivedAt }])
      mockDb.select.mockReturnValue(chain)

      const result = await getWorkspaceWithOwner('workspace123', { includeArchived: true })

      expect(result).toEqual({ id: 'workspace123', ownerId: 'owner456', archivedAt })
    })
  })

  describe('checkWorkspaceAccess', () => {
    it('should return hasAccess=false when user has no permissions', async () => {
      let callCount = 0
      mockDb.select.mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          return createMockChain([{ id: 'workspace123', ownerId: 'other-user' }])
        }
        return createMockChain([]) // No permissions
      })

      const result = await checkWorkspaceAccess('workspace123', 'user123')

      expect(result.exists).toBe(true)
      expect(result.hasAccess).toBe(false)
      expect(result.canWrite).toBe(false)
    })

    it('should return canWrite=false when user has read permission', async () => {
      let callCount = 0
      mockDb.select.mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          return createMockChain([{ id: 'workspace123', ownerId: 'other-user' }])
        }
        return createMockChain([{ permissionType: 'read' }])
      })

      const result = await checkWorkspaceAccess('workspace123', 'user123')

      expect(result.exists).toBe(true)
      expect(result.hasAccess).toBe(true)
      expect(result.canWrite).toBe(false)
    })
  })

  describe('organization admin inheritance', () => {
    function mockSelectSequence(results: any[][]) {
      let index = 0
      mockDb.select.mockImplementation(() => createMockChain(results[index++] ?? []))
    }

    it('checkWorkspaceAccess grants admin to org admins without an explicit row', async () => {
      mockSelectSequence([
        [{ id: 'ws', ownerId: 'other-user', organizationId: 'org-1' }],
        [],
        [{ role: 'admin' }],
      ])

      const result = await checkWorkspaceAccess('ws', 'org-admin-user')

      expect(result.hasAccess).toBe(true)
      expect(result.canWrite).toBe(true)
      expect(result.canAdmin).toBe(true)
    })

    it('does not elevate a plain org member', async () => {
      mockSelectSequence([
        [{ id: 'ws', ownerId: 'other-user', organizationId: 'org-1' }],
        [],
        [{ role: 'member' }],
      ])

      const result = await checkWorkspaceAccess('ws', 'org-member-user')

      expect(result.hasAccess).toBe(false)
      expect(result.canAdmin).toBe(false)
    })

    it('does not elevate org admins on a workspace with no organization', async () => {
      mockSelectSequence([[{ id: 'ws', ownerId: 'other-user', organizationId: null }], []])

      const result = await checkWorkspaceAccess('ws', 'some-user')

      expect(result.hasAccess).toBe(false)
    })
  })
})

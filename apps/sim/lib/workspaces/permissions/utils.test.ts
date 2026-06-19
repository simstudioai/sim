import { db } from '@sim/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  checkWorkspaceAccess,
  getManageableWorkspaces,
  getUserEntityPermissions,
  getUsersWithPermissions,
  getWorkspaceById,
  getWorkspaceWithOwner,
  hasWorkspaceAdminAccess,
  workspaceExists,
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
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getUserEntityPermissions', () => {
    it('should return null when user has no permissions', async () => {
      const chain = createMockChain([])
      mockDb.select.mockReturnValue(chain)

      const result = await getUserEntityPermissions('user123', 'workspace', 'workspace456')

      expect(result).toBeNull()
    })

    it('should return the highest permission when user has multiple permissions', async () => {
      const mockResults = [
        { permissionType: 'read' as PermissionType },
        { permissionType: 'admin' as PermissionType },
        { permissionType: 'write' as PermissionType },
      ]
      const chain = createMockChain(mockResults)
      mockDb.select.mockReturnValue(chain)

      const result = await getUserEntityPermissions('user123', 'workflow', 'workflow456')

      expect(result).toBe('admin')
    })

    it('should return single permission when user has only one', async () => {
      const mockResults = [{ permissionType: 'read' as PermissionType }]
      const chain = createMockChain(mockResults)
      mockDb.select.mockReturnValue(chain)

      const result = await getUserEntityPermissions('user123', 'workflow', 'workflow789')

      expect(result).toBe('read')
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

    it('should return write permission when user only has write access', async () => {
      const mockResults = [{ permissionType: 'write' as PermissionType }]
      const chain = createMockChain(mockResults)
      mockDb.select.mockReturnValue(chain)

      const result = await getUserEntityPermissions('user123', 'workspace', 'workspace456')

      expect(result).toBe('write')
    })

    it('should prioritize write over read permissions', async () => {
      const mockResults = [
        { permissionType: 'read' as PermissionType },
        { permissionType: 'write' as PermissionType },
      ]
      const chain = createMockChain(mockResults)
      mockDb.select.mockReturnValue(chain)

      const result = await getUserEntityPermissions('user123', 'workflow', 'workflow456')

      expect(result).toBe('write')
    })

    it('should work with workflow entity type', async () => {
      const mockResults = [{ permissionType: 'admin' as PermissionType }]
      const chain = createMockChain(mockResults)
      mockDb.select.mockReturnValue(chain)

      const result = await getUserEntityPermissions('user123', 'workflow', 'workflow789')

      expect(result).toBe('admin')
    })

    it('should work with organization entity type', async () => {
      const mockResults = [{ permissionType: 'read' as PermissionType }]
      const chain = createMockChain(mockResults)
      mockDb.select.mockReturnValue(chain)

      const result = await getUserEntityPermissions('user123', 'organization', 'org456')

      expect(result).toBe('read')
    })

    it('should handle generic entity types', async () => {
      const mockResults = [{ permissionType: 'write' as PermissionType }]
      const chain = createMockChain(mockResults)
      mockDb.select.mockReturnValue(chain)

      const result = await getUserEntityPermissions('user123', 'custom_entity', 'entity123')

      expect(result).toBe('write')
    })
  })

  describe('getUsersWithPermissions', () => {
    function mockSelectSequence(results: any[][]) {
      let index = 0
      mockDb.select.mockImplementation(() => createMockChain(results[index++] ?? []))
    }

    const joinedAt = new Date('2026-04-22T00:00:00.000Z')

    it('should return empty array when the workspace does not exist', async () => {
      mockSelectSequence([[]])

      const result = await getUsersWithPermissions('workspace123')

      expect(result).toEqual([])
    })

    it('should return users with their explicit permissions for a personal workspace', async () => {
      mockSelectSequence([
        [{ id: 'workspace456', ownerId: 'owner-user', organizationId: null }],
        [
          {
            userId: 'user1',
            email: 'alice@example.com',
            name: 'Alice Smith',
            image: 'https://example.com/alice.png',
            permissionType: 'admin' as PermissionType,
            joinedAt,
            userOrganizationId: null,
          },
        ],
      ])

      const result = await getUsersWithPermissions('workspace456')

      expect(result).toEqual([
        {
          userId: 'user1',
          email: 'alice@example.com',
          name: 'Alice Smith',
          image: 'https://example.com/alice.png',
          permissionType: 'admin',
          isExternal: false,
          joinedAt: '2026-04-22T00:00:00.000Z',
          roleSource: 'explicit',
        },
      ])
    })

    it('tags the workspace owner with roleSource owner', async () => {
      mockSelectSequence([
        [{ id: 'workspace456', ownerId: 'user1', organizationId: null }],
        [
          {
            userId: 'user1',
            email: 'owner@example.com',
            name: 'Owner',
            image: null,
            permissionType: 'admin' as PermissionType,
            joinedAt,
            userOrganizationId: null,
          },
        ],
      ])

      const result = await getUsersWithPermissions('workspace456')

      expect(result[0].roleSource).toBe('owner')
    })

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

    it('should return multiple users sorted by email', async () => {
      mockSelectSequence([
        [{ id: 'ws', ownerId: 'owner-user', organizationId: null }],
        [
          {
            userId: 'user1',
            email: 'a-admin@example.com',
            name: 'Admin User',
            image: null,
            permissionType: 'admin' as PermissionType,
            joinedAt,
            userOrganizationId: null,
          },
          {
            userId: 'user2',
            email: 'b-writer@example.com',
            name: 'Writer User',
            image: null,
            permissionType: 'write' as PermissionType,
            joinedAt,
            userOrganizationId: null,
          },
          {
            userId: 'user3',
            email: 'c-reader@example.com',
            name: 'Reader User',
            image: null,
            permissionType: 'read' as PermissionType,
            joinedAt,
            userOrganizationId: null,
          },
        ],
      ])

      const result = await getUsersWithPermissions('workspace456')

      expect(result).toHaveLength(3)
      expect(result[0].permissionType).toBe('admin')
      expect(result[1].permissionType).toBe('write')
      expect(result[2].permissionType).toBe('read')
    })

    it('should handle users with empty names', async () => {
      mockSelectSequence([
        [{ id: 'ws', ownerId: 'owner-user', organizationId: null }],
        [
          {
            userId: 'user1',
            email: 'test@example.com',
            name: '',
            image: null,
            permissionType: 'read' as PermissionType,
            joinedAt,
            userOrganizationId: null,
          },
        ],
      ])

      const result = await getUsersWithPermissions('workspace123')

      expect(result[0].name).toBe('')
    })
  })

  describe('hasWorkspaceAdminAccess', () => {
    it('should return true for the workspace owner via their explicit admin row', async () => {
      let callCount = 0
      mockDb.select.mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          return createMockChain([{ ownerId: 'user123' }])
        }
        return createMockChain([{ permissionType: 'admin' }])
      })

      const result = await hasWorkspaceAdminAccess('user123', 'workspace456')

      expect(result).toBe(true)
    })

    it('should return true when user has direct admin permission', async () => {
      let callCount = 0
      mockDb.select.mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          return createMockChain([{ ownerId: 'other-user' }])
        }
        return createMockChain([{ permissionType: 'admin' }])
      })

      const result = await hasWorkspaceAdminAccess('user123', 'workspace456')

      expect(result).toBe(true)
    })

    it('should return false when workspace does not exist', async () => {
      const chain = createMockChain([])
      mockDb.select.mockReturnValue(chain)

      const result = await hasWorkspaceAdminAccess('user123', 'workspace456')

      expect(result).toBe(false)
    })

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

    it('should return false when user has read permission but not admin', async () => {
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

    it('should handle empty workspace ID', async () => {
      const chain = createMockChain([])
      mockDb.select.mockReturnValue(chain)

      const result = await hasWorkspaceAdminAccess('user123', '')

      expect(result).toBe(false)
    })

    it('should handle empty user ID', async () => {
      const chain = createMockChain([])
      mockDb.select.mockReturnValue(chain)

      const result = await hasWorkspaceAdminAccess('', 'workspace456')

      expect(result).toBe(false)
    })
  })

  describe('Edge Cases and Security Tests', () => {
    it('should handle SQL injection attempts in user IDs', async () => {
      const chain = createMockChain([])
      mockDb.select.mockReturnValue(chain)

      const result = await getUserEntityPermissions(
        "'; DROP TABLE users; --",
        'workspace',
        'workspace123'
      )

      expect(result).toBeNull()
    })

    it('should handle very long entity IDs', async () => {
      const longEntityId = 'a'.repeat(1000)
      const chain = createMockChain([])
      mockDb.select.mockReturnValue(chain)

      const result = await getUserEntityPermissions('user123', 'workspace', longEntityId)

      expect(result).toBeNull()
    })

    it('should handle unicode characters in entity names', async () => {
      const chain = createMockChain([{ permissionType: 'read' as PermissionType }])
      mockDb.select.mockReturnValue(chain)

      const result = await getUserEntityPermissions('user123', '📝workspace', '🏢org-id')

      expect(result).toBe('read')
    })

    it('should verify permission hierarchy ordering is consistent', () => {
      const permissionOrder: Record<PermissionType, number> = { admin: 3, write: 2, read: 1 }

      expect(permissionOrder.admin).toBeGreaterThan(permissionOrder.write)
      expect(permissionOrder.write).toBeGreaterThan(permissionOrder.read)
    })

    it('should handle workspace ownership checks with null owner IDs', async () => {
      let callCount = 0
      mockDb.select.mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          return createMockChain([{ ownerId: null }])
        }
        return createMockChain([])
      })

      const result = await hasWorkspaceAdminAccess('user123', 'workspace456')

      expect(result).toBe(false)
    })

    it('should handle null user ID correctly when owner ID is different', async () => {
      let callCount = 0
      mockDb.select.mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          return createMockChain([{ ownerId: 'other-user' }])
        }
        return createMockChain([])
      })

      const result = await hasWorkspaceAdminAccess(null as any, 'workspace456')

      expect(result).toBe(false)
    })
  })

  describe('getManageableWorkspaces', () => {
    it('should return empty array when user has no manageable workspaces', async () => {
      const chain = createMockChain([])
      mockDb.select.mockReturnValue(chain)

      const result = await getManageableWorkspaces('user123')

      expect(result).toEqual([])
    })

    it('should return owned workspaces', async () => {
      const mockWorkspaces = [
        { id: 'ws1', name: 'My Workspace 1', ownerId: 'user123' },
        { id: 'ws2', name: 'My Workspace 2', ownerId: 'user123' },
      ]

      let callCount = 0
      mockDb.select.mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          return createMockChain(mockWorkspaces) // Owned workspaces
        }
        return createMockChain([]) // No admin workspaces
      })

      const result = await getManageableWorkspaces('user123')

      expect(result).toEqual([
        { id: 'ws1', name: 'My Workspace 1', ownerId: 'user123', accessType: 'owner' },
        { id: 'ws2', name: 'My Workspace 2', ownerId: 'user123', accessType: 'owner' },
      ])
    })

    it('should return workspaces with direct admin permissions', async () => {
      const mockAdminWorkspaces = [{ id: 'ws1', name: 'Shared Workspace', ownerId: 'other-user' }]

      let callCount = 0
      mockDb.select.mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          return createMockChain([]) // No owned workspaces
        }
        return createMockChain(mockAdminWorkspaces) // Admin workspaces
      })

      const result = await getManageableWorkspaces('user123')

      expect(result).toEqual([
        { id: 'ws1', name: 'Shared Workspace', ownerId: 'other-user', accessType: 'direct' },
      ])
    })

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

    it('should handle empty workspace names', async () => {
      const mockWorkspaces = [{ id: 'ws1', name: '', ownerId: 'user123' }]

      let callCount = 0
      mockDb.select.mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          return createMockChain(mockWorkspaces)
        }
        return createMockChain([])
      })

      const result = await getManageableWorkspaces('user123')

      expect(result[0].name).toBe('')
    })

    it('should handle multiple admin permissions for same workspace', async () => {
      const mockAdminWorkspaces = [
        { id: 'ws1', name: 'Shared Workspace', ownerId: 'other-user' },
        { id: 'ws1', name: 'Shared Workspace', ownerId: 'other-user' }, // Duplicate
      ]

      let callCount = 0
      mockDb.select.mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          return createMockChain([]) // No owned workspaces
        }
        return createMockChain(mockAdminWorkspaces) // Admin workspaces with duplicates
      })

      const result = await getManageableWorkspaces('user123')

      expect(result).toHaveLength(1)
    })

    it('should handle empty user ID gracefully', async () => {
      const chain = createMockChain([])
      mockDb.select.mockReturnValue(chain)

      const result = await getManageableWorkspaces('')

      expect(result).toEqual([])
    })
  })

  describe('getWorkspaceById', () => {
    it.concurrent('should return workspace when it exists', async () => {
      const chain = createMockChain([{ id: 'workspace123' }])
      mockDb.select.mockReturnValue(chain)

      const result = await getWorkspaceById('workspace123')

      expect(result).toEqual({ id: 'workspace123' })
    })

    it.concurrent('should return null when workspace does not exist', async () => {
      const chain = createMockChain([])
      mockDb.select.mockReturnValue(chain)

      const result = await getWorkspaceById('non-existent')

      expect(result).toBeNull()
    })

    it.concurrent('should handle empty workspace ID', async () => {
      const chain = createMockChain([])
      mockDb.select.mockReturnValue(chain)

      const result = await getWorkspaceById('')

      expect(result).toBeNull()
    })
  })

  describe('getWorkspaceWithOwner', () => {
    it.concurrent('should return workspace with owner when it exists', async () => {
      const chain = createMockChain([{ id: 'workspace123', ownerId: 'owner456' }])
      mockDb.select.mockReturnValue(chain)

      const result = await getWorkspaceWithOwner('workspace123')

      expect(result).toEqual({ id: 'workspace123', ownerId: 'owner456' })
    })

    it.concurrent('should return null when workspace does not exist', async () => {
      const chain = createMockChain([])
      mockDb.select.mockReturnValue(chain)

      const result = await getWorkspaceWithOwner('non-existent')

      expect(result).toBeNull()
    })

    it.concurrent('should handle workspace with null owner ID', async () => {
      const chain = createMockChain([{ id: 'workspace123', ownerId: null }])
      mockDb.select.mockReturnValue(chain)

      const result = await getWorkspaceWithOwner('workspace123')

      expect(result).toEqual({ id: 'workspace123', ownerId: null })
    })
  })

  describe('workspaceExists', () => {
    it.concurrent('should return true when workspace exists', async () => {
      const chain = createMockChain([{ id: 'workspace123' }])
      mockDb.select.mockReturnValue(chain)

      const result = await workspaceExists('workspace123')

      expect(result).toBe(true)
    })

    it.concurrent('should return false when workspace does not exist', async () => {
      const chain = createMockChain([])
      mockDb.select.mockReturnValue(chain)

      const result = await workspaceExists('non-existent')

      expect(result).toBe(false)
    })

    it.concurrent('should handle empty workspace ID', async () => {
      const chain = createMockChain([])
      mockDb.select.mockReturnValue(chain)

      const result = await workspaceExists('')

      expect(result).toBe(false)
    })
  })

  describe('checkWorkspaceAccess', () => {
    it('should return exists=false when workspace does not exist', async () => {
      const chain = createMockChain([])
      mockDb.select.mockReturnValue(chain)

      const result = await checkWorkspaceAccess('non-existent', 'user123')

      expect(result).toEqual({
        exists: false,
        hasAccess: false,
        canWrite: false,
        canAdmin: false,
        workspace: null,
      })
    })

    it('should return full access for the workspace owner via their explicit admin row', async () => {
      let callCount = 0
      mockDb.select.mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          return createMockChain([{ id: 'workspace123', ownerId: 'user123' }])
        }
        return createMockChain([{ permissionType: 'admin' }])
      })

      const result = await checkWorkspaceAccess('workspace123', 'user123')

      expect(result).toEqual({
        exists: true,
        hasAccess: true,
        canWrite: true,
        canAdmin: true,
        workspace: { id: 'workspace123', ownerId: 'user123' },
      })
    })

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

    it('should return canWrite=true when user has admin permission', async () => {
      let callCount = 0
      mockDb.select.mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          return createMockChain([{ id: 'workspace123', ownerId: 'other-user' }])
        }
        return createMockChain([{ permissionType: 'admin' }])
      })

      const result = await checkWorkspaceAccess('workspace123', 'user123')

      expect(result.exists).toBe(true)
      expect(result.hasAccess).toBe(true)
      expect(result.canWrite).toBe(true)
    })

    it('should return canWrite=true when user has write permission', async () => {
      let callCount = 0
      mockDb.select.mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          return createMockChain([{ id: 'workspace123', ownerId: 'other-user' }])
        }
        return createMockChain([{ permissionType: 'write' }])
      })

      const result = await checkWorkspaceAccess('workspace123', 'user123')

      expect(result.exists).toBe(true)
      expect(result.hasAccess).toBe(true)
      expect(result.canWrite).toBe(true)
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

    it('should handle empty user ID', async () => {
      const chain = createMockChain([])
      mockDb.select.mockReturnValue(chain)

      const result = await checkWorkspaceAccess('workspace123', '')

      expect(result.exists).toBe(false)
      expect(result.hasAccess).toBe(false)
    })

    it('should handle empty workspace ID', async () => {
      const chain = createMockChain([])
      mockDb.select.mockReturnValue(chain)

      const result = await checkWorkspaceAccess('', 'user123')

      expect(result.exists).toBe(false)
      expect(result.hasAccess).toBe(false)
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

    it('getUserEntityPermissions returns admin for an org owner without an explicit row', async () => {
      mockSelectSequence([
        [{ id: 'ws', ownerId: 'other-user', organizationId: 'org-1' }],
        [],
        [{ role: 'owner' }],
      ])

      const result = await getUserEntityPermissions('org-owner-user', 'workspace', 'ws')

      expect(result).toBe('admin')
    })

    it('hasWorkspaceAdminAccess is true for an org admin of the workspace org', async () => {
      mockSelectSequence([
        [{ id: 'ws', ownerId: 'other-user', organizationId: 'org-1' }],
        [],
        [{ role: 'admin' }],
      ])

      const result = await hasWorkspaceAdminAccess('org-admin-user', 'ws')

      expect(result).toBe(true)
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

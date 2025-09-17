import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db', () => ({
  db: {
    select: vi.fn(),
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
    innerJoin: vi.fn(),
    leftJoin: vi.fn(),
    orderBy: vi.fn(),
  },
}))

vi.mock('@sim/db/schema', () => ({
  permissions: {
    permissionType: 'permission_type',
    userId: 'user_id',
    entityType: 'entity_type',
    entityId: 'entity_id',
    id: 'permission_id',
  },
  permissionTypeEnum: {
    enumValues: ['admin', 'write', 'read'] as const,
  },
  user: {
    id: 'user_id',
    email: 'user_email',
    name: 'user_name',
  },
  workspace: {
    id: 'workspace_id',
    name: 'workspace_name',
    ownerId: 'workspace_owner_id',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn().mockReturnValue('and-condition'),
  eq: vi.fn().mockReturnValue('eq-condition'),
  or: vi.fn().mockReturnValue('or-condition'),
}))

import { db } from '@sim/db'
import {
  getManageableWorkspaces,
  getUserEntityPermissions,
  getUsersWithPermissions,
  hasAdminPermission,
  hasWorkspaceAdminAccess,
} from '@/lib/permissions/utils'

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

      const result = await getUserEntityPermissions('user123', 'workspace', 'workspace456')

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

      const result = await getUserEntityPermissions('user999', 'workspace', 'workspace999')

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

      const result = await getUserEntityPermissions('user123', 'workspace', 'workspace456')

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

  describe('hasAdminPermission', () => {
    it('should return true when user has admin permission for workspace', async () => {
      const chain = createMockChain([{ id: 'perm1' }])
      mockDb.select.mockReturnValue(chain)

      const result = await hasAdminPermission('admin-user', 'workspace123')

      expect(result).toBe(true)
    })

    it('should return false when user has no admin permission for workspace', async () => {
      const chain = createMockChain([])
      mockDb.select.mockReturnValue(chain)

      const result = await hasAdminPermission('regular-user', 'workspace123')

      expect(result).toBe(false)
    })

    it('should return false when user has write permission but not admin', async () => {
      const chain = createMockChain([])
      mockDb.select.mockReturnValue(chain)

      const result = await hasAdminPermission('write-user', 'workspace123')

      expect(result).toBe(false)
    })

    it('should return false when user has read permission but not admin', async () => {
      const chain = createMockChain([])
      mockDb.select.mockReturnValue(chain)

      const result = await hasAdminPermission('read-user', 'workspace123')

      expect(result).toBe(false)
    })

    it('should handle non-existent workspace', async () => {
      const chain = createMockChain([])
      mockDb.select.mockReturnValue(chain)

      const result = await hasAdminPermission('user123', 'non-existent-workspace')

      expect(result).toBe(false)
    })

    it('should handle empty user ID', async () => {
      const chain = createMockChain([])
      mockDb.select.mockReturnValue(chain)

      const result = await hasAdminPermission('', 'workspace123')

      expect(result).toBe(false)
    })
  })

  describe('getUsersWithPermissions', () => {
    it('should return empty array when no users have permissions for workspace', async () => {
      const usersChain = createMockChain([])
      mockDb.select.mockReturnValue(usersChain)

      const result = await getUsersWithPermissions('workspace123')

      expect(result).toEqual([])
    })

    it('should return users with their permissions for workspace', async () => {
      const mockUsersResults = [
        {
          userId: 'user1',
          email: 'alice@example.com',
          name: 'Alice Smith',
          permissionType: 'admin' as PermissionType,
        },
      ]

      const usersChain = createMockChain(mockUsersResults)
      mockDb.select.mockReturnValue(usersChain)

      const result = await getUsersWithPermissions('workspace456')

      expect(result).toEqual([
        {
          userId: 'user1',
          email: 'alice@example.com',
          name: 'Alice Smith',
          permissionType: 'admin',
        },
      ])
    })

    it('should return multiple users with different permission levels', async () => {
      const mockUsersResults = [
        {
          userId: 'user1',
          email: 'admin@example.com',
          name: 'Admin User',
          permissionType: 'admin' as PermissionType,
        },
        {
          userId: 'user2',
          email: 'writer@example.com',
          name: 'Writer User',
          permissionType: 'write' as PermissionType,
        },
        {
          userId: 'user3',
          email: 'reader@example.com',
          name: 'Reader User',
          permissionType: 'read' as PermissionType,
        },
      ]

      const usersChain = createMockChain(mockUsersResults)
      mockDb.select.mockReturnValue(usersChain)

      const result = await getUsersWithPermissions('workspace456')

      expect(result).toHaveLength(3)
      expect(result[0].permissionType).toBe('admin')
      expect(result[1].permissionType).toBe('write')
      expect(result[2].permissionType).toBe('read')
    })

    it('should handle users with empty names', async () => {
      const mockUsersResults = [
        {
          userId: 'user1',
          email: 'test@example.com',
          name: '',
          permissionType: 'read' as PermissionType,
        },
      ]

      const usersChain = createMockChain(mockUsersResults)
      mockDb.select.mockReturnValue(usersChain)

      const result = await getUsersWithPermissions('workspace123')

      expect(result[0].name).toBe('')
    })
  })

  describe('hasWorkspaceAdminAccess', () => {
    it('should return true when user owns the workspace', async () => {
      const chain = createMockChain([{ ownerId: 'user123' }])
      mockDb.select.mockReturnValue(chain)

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
        return createMockChain([{ id: 'perm1' }])
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

      expect(result).toHaveLength(2) // Should include duplicates from admin permissions
    })

    it('should handle empty user ID gracefully', async () => {
      const chain = createMockChain([])
      mockDb.select.mockReturnValue(chain)

      const result = await getManageableWorkspaces('')

      expect(result).toEqual([])
    })
  })
})

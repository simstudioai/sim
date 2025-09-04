import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/db', () => ({
  db: {
    select: vi.fn(),
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
    innerJoin: vi.fn(),
    orderBy: vi.fn(),
  },
}))

vi.mock('@/db/schema', () => ({
  permissions: {
    permissionType: 'permission_type',
    userId: 'user_id',
    entityType: 'entity_type',
    entityId: 'entity_id',
  },
  permissionTypeEnum: {
    enumValues: ['admin', 'write', 'read'] as const,
  },
  user: {
    id: 'user_id',
    email: 'user_email',
    name: 'user_name',
    image: 'user_image',
  },
  workspace: {
    id: 'workspace_id',
    name: 'workspace_name',
    ownerId: 'workspace_owner_id',
  },
  member: {
    userId: 'member_user_id',
    organizationId: 'member_organization_id',
    role: 'member_role',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn().mockReturnValue('and-condition'),
  eq: vi.fn().mockReturnValue('eq-condition'),
}))

import {
  getManageableWorkspaces,
  getUserEntityPermissions,
  getUsersWithPermissions,
  hasAdminPermission,
  hasWorkspaceAdminAccess,
  isOrganizationAdminForWorkspace,
  isOrganizationOwnerOrAdmin,
} from '@/lib/permissions/utils'
import { db } from '@/db'

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
  })

  describe('hasAdminPermission', () => {
    it('should return true when user has admin permission for workspace', async () => {
      const chain = createMockChain([{ permissionType: 'admin' }])
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
          image: 'https://example.com/alice.jpg',
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
          image: 'https://example.com/alice.jpg',
          permissionType: 'admin',
        },
      ])
    })
  })

  describe('isOrganizationAdminForWorkspace', () => {
    it('should return false when workspace does not exist', async () => {
      const chain = createMockChain([])
      mockDb.select.mockReturnValue(chain)

      const result = await isOrganizationAdminForWorkspace('user123', 'workspace456')

      expect(result).toBe(false)
    })

    it('should return false when user has no organization memberships', async () => {
      // Mock workspace exists, but user has no org memberships
      let callCount = 0
      mockDb.select.mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          return createMockChain([{ ownerId: 'workspace-owner-123' }])
        }
        return createMockChain([]) // No memberships
      })

      const result = await isOrganizationAdminForWorkspace('user123', 'workspace456')

      expect(result).toBe(false)
    })
  })

  describe('hasWorkspaceAdminAccess', () => {
    it('should return true when user has direct admin permission', async () => {
      const chain = createMockChain([{ permissionType: 'admin' }])
      mockDb.select.mockReturnValue(chain)

      const result = await hasWorkspaceAdminAccess('user123', 'workspace456')

      expect(result).toBe(true)
    })

    it('should return false when user has neither direct nor organization admin access', async () => {
      const chain = createMockChain([])
      mockDb.select.mockReturnValue(chain)

      const result = await hasWorkspaceAdminAccess('user123', 'workspace456')

      expect(result).toBe(false)
    })
  })

  describe('isOrganizationOwnerOrAdmin', () => {
    it('should return true when user is owner of organization', async () => {
      const chain = createMockChain([{ role: 'owner' }])
      mockDb.select.mockReturnValue(chain)

      const result = await isOrganizationOwnerOrAdmin('user123', 'org456')

      expect(result).toBe(true)
    })

    it('should return true when user is admin of organization', async () => {
      const chain = createMockChain([{ role: 'admin' }])
      mockDb.select.mockReturnValue(chain)

      const result = await isOrganizationOwnerOrAdmin('user123', 'org456')

      expect(result).toBe(true)
    })

    it('should return false when user is regular member of organization', async () => {
      const chain = createMockChain([{ role: 'member' }])
      mockDb.select.mockReturnValue(chain)

      const result = await isOrganizationOwnerOrAdmin('user123', 'org456')

      expect(result).toBe(false)
    })

    it('should return false when user is not member of organization', async () => {
      const chain = createMockChain([])
      mockDb.select.mockReturnValue(chain)

      const result = await isOrganizationOwnerOrAdmin('user123', 'org456')

      expect(result).toBe(false)
    })

    it('should handle errors gracefully', async () => {
      mockDb.select.mockImplementation(() => {
        throw new Error('Database error')
      })

      const result = await isOrganizationOwnerOrAdmin('user123', 'org456')

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

    it('should return direct admin workspaces', async () => {
      const mockDirectWorkspaces = [
        { id: 'ws1', name: 'Workspace 1', ownerId: 'owner1' },
        { id: 'ws2', name: 'Workspace 2', ownerId: 'owner2' },
      ]

      let callCount = 0
      mockDb.select.mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          return createMockChain(mockDirectWorkspaces) // direct admin workspaces
        }
        return createMockChain([]) // no organization memberships
      })

      const result = await getManageableWorkspaces('user123')

      expect(result).toEqual([
        { id: 'ws1', name: 'Workspace 1', ownerId: 'owner1', accessType: 'direct' },
        { id: 'ws2', name: 'Workspace 2', ownerId: 'owner2', accessType: 'direct' },
      ])
    })
  })
})

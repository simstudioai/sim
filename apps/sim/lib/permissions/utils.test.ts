import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getUserEntityPermissions, getUsersWithPermissions, hasAdminPermission } from './utils'

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
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn().mockReturnValue('and-condition'),
  eq: vi.fn().mockReturnValue('eq-condition'),
}))

import { db } from '@/db'
import { permissions, user } from '@/db/schema'

const mockDb = db as any

type PermissionType = 'admin' | 'write' | 'read'

describe('Permission Utils', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockDb.select.mockReturnValue(mockDb)
    mockDb.from.mockReturnValue(mockDb)
    mockDb.where.mockReturnValue(mockDb)
    mockDb.limit.mockResolvedValue([])
    mockDb.innerJoin.mockReturnValue(mockDb)
    mockDb.orderBy.mockReturnValue(mockDb)
  })

  describe('getUserEntityPermissions', () => {
    it.concurrent('should return null when user has no permissions', async () => {
      mockDb.where.mockResolvedValue([])

      const result = await getUserEntityPermissions('user123', 'workspace', 'workspace456')

      expect(result).toBeNull()
      expect(mockDb.select).toHaveBeenCalledWith({ permissionType: permissions.permissionType })
      expect(mockDb.from).toHaveBeenCalledWith(permissions)
      expect(mockDb.where).toHaveBeenCalledWith('and-condition')
    })

    it.concurrent(
      'should return the highest permission when user has multiple permissions',
      async () => {
        const mockResults = [
          { permissionType: 'read' as PermissionType },
          { permissionType: 'admin' as PermissionType },
          { permissionType: 'write' as PermissionType },
        ]
        mockDb.where.mockResolvedValue(mockResults)

        const result = await getUserEntityPermissions('user123', 'workspace', 'workspace456')

        expect(result).toBe('admin')
        expect(mockDb.select).toHaveBeenCalledWith({
          permissionType: permissions.permissionType,
        })
        expect(mockDb.from).toHaveBeenCalledWith(permissions)
      }
    )

    it.concurrent('should return single permission when user has only one', async () => {
      const mockResults = [{ permissionType: 'read' as PermissionType }]
      mockDb.where.mockResolvedValue(mockResults)

      const result = await getUserEntityPermissions('user123', 'workflow', 'workflow789')

      expect(result).toBe('read')
    })

    it.concurrent('should handle different entity types', async () => {
      const mockResults = [{ permissionType: 'write' as PermissionType }]
      mockDb.where.mockResolvedValue(mockResults)

      const result = await getUserEntityPermissions('user456', 'organization', 'org123')

      expect(result).toBe('write')
    })

    it.concurrent(
      'should return highest permission when multiple exist (admin > write > read)',
      async () => {
        const mockResults = [
          { permissionType: 'read' as PermissionType },
          { permissionType: 'write' as PermissionType },
        ]
        mockDb.where.mockResolvedValue(mockResults)

        const result = await getUserEntityPermissions('user789', 'workspace', 'workspace123')

        expect(result).toBe('write')
      }
    )

    it.concurrent('should prioritize admin over other permissions', async () => {
      const mockResults = [
        { permissionType: 'write' as PermissionType },
        { permissionType: 'admin' as PermissionType },
        { permissionType: 'read' as PermissionType },
      ]
      mockDb.where.mockResolvedValue(mockResults)

      const result = await getUserEntityPermissions('user999', 'workspace', 'workspace999')

      expect(result).toBe('admin')
    })

    it.concurrent('should handle edge case with single admin permission', async () => {
      const mockResults = [{ permissionType: 'admin' as PermissionType }]
      mockDb.where.mockResolvedValue(mockResults)

      const result = await getUserEntityPermissions('admin-user', 'workspace', 'workspace-admin')

      expect(result).toBe('admin')
    })

    it.concurrent('should correctly prioritize write over read', async () => {
      const mockResults = [
        { permissionType: 'read' as PermissionType },
        { permissionType: 'write' as PermissionType },
        { permissionType: 'read' as PermissionType },
      ]
      mockDb.where.mockResolvedValue(mockResults)

      const result = await getUserEntityPermissions('write-user', 'workflow', 'workflow-write')

      expect(result).toBe('write')
    })
  })

  describe('hasAdminPermission', () => {
    it.concurrent('should return true when user has admin permission for workspace', async () => {
      const mockResult = [
        {
          /* some admin permission record */
        },
      ]
      mockDb.limit.mockResolvedValue(mockResult)

      const result = await hasAdminPermission('admin-user', 'workspace123')

      expect(result).toBe(true)
      expect(mockDb.select).toHaveBeenCalledWith()
      expect(mockDb.from).toHaveBeenCalledWith(permissions)
      expect(mockDb.where).toHaveBeenCalledWith('and-condition')
      expect(mockDb.limit).toHaveBeenCalledWith(1)
    })

    it.concurrent(
      'should return false when user has no admin permission for workspace',
      async () => {
        mockDb.limit.mockResolvedValue([])

        const result = await hasAdminPermission('regular-user', 'workspace123')

        expect(result).toBe(false)
        expect(mockDb.select).toHaveBeenCalledWith()
        expect(mockDb.from).toHaveBeenCalledWith(permissions)
        expect(mockDb.where).toHaveBeenCalledWith('and-condition')
        expect(mockDb.limit).toHaveBeenCalledWith(1)
      }
    )

    it.concurrent('should handle different user and workspace combinations', async () => {
      // Test with no admin permission
      mockDb.limit.mockResolvedValue([])

      const result1 = await hasAdminPermission('user456', 'workspace789')
      expect(result1).toBe(false)

      // Test with admin permission
      const mockAdminResult = [{ permissionType: 'admin' }]
      mockDb.limit.mockResolvedValue(mockAdminResult)

      const result2 = await hasAdminPermission('admin789', 'workspace456')
      expect(result2).toBe(true)
    })

    it.concurrent(
      'should call database with correct parameters for workspace admin check',
      async () => {
        mockDb.limit.mockResolvedValue([])

        await hasAdminPermission('test-user-id', 'test-workspace-id')

        expect(mockDb.select).toHaveBeenCalledWith()
        expect(mockDb.from).toHaveBeenCalledWith(permissions)
        expect(mockDb.where).toHaveBeenCalledWith('and-condition')
        expect(mockDb.limit).toHaveBeenCalledWith(1)
      }
    )

    it.concurrent(
      'should return true even if multiple admin records exist (due to limit 1)',
      async () => {
        // This shouldn't happen in practice, but tests the limit functionality
        const mockResult = [{ permissionType: 'admin' }] // Only one record due to limit(1)
        mockDb.limit.mockResolvedValue(mockResult)

        const result = await hasAdminPermission('super-admin', 'workspace999')

        expect(result).toBe(true)
        expect(mockDb.limit).toHaveBeenCalledWith(1)
      }
    )

    it.concurrent('should handle edge cases with empty strings', async () => {
      mockDb.limit.mockResolvedValue([])

      const result = await hasAdminPermission('', '')

      expect(result).toBe(false)
      expect(mockDb.select).toHaveBeenCalled()
    })

    it.concurrent('should return false for non-existent workspace', async () => {
      mockDb.limit.mockResolvedValue([])

      const result = await hasAdminPermission('user123', 'non-existent-workspace')

      expect(result).toBe(false)
    })

    it.concurrent('should return false for non-existent user', async () => {
      mockDb.limit.mockResolvedValue([])

      const result = await hasAdminPermission('non-existent-user', 'workspace123')

      expect(result).toBe(false)
    })
  })

  describe('getUsersWithPermissions', () => {
    it.concurrent(
      'should return empty array when no users have permissions for workspace',
      async () => {
        mockDb.orderBy.mockResolvedValue([])

        const result = await getUsersWithPermissions('workspace123')

        expect(result).toEqual([])
        expect(mockDb.select).toHaveBeenCalledWith({
          userId: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          permissionType: permissions.permissionType,
        })
        expect(mockDb.from).toHaveBeenCalledWith(permissions)
        expect(mockDb.innerJoin).toHaveBeenCalledWith(user, 'eq-condition')
        expect(mockDb.where).toHaveBeenCalledWith('and-condition')
        expect(mockDb.orderBy).toHaveBeenCalledWith(user.email)
      }
    )

    it.concurrent('should return users with their permissions for workspace', async () => {
      const mockResults = [
        {
          userId: 'user1',
          email: 'alice@example.com',
          name: 'Alice Smith',
          image: 'https://example.com/alice.jpg',
          permissionType: 'admin' as PermissionType,
        },
        {
          userId: 'user2',
          email: 'bob@example.com',
          name: 'Bob Johnson',
          image: 'https://example.com/bob.jpg',
          permissionType: 'write' as PermissionType,
        },
        {
          userId: 'user3',
          email: 'charlie@example.com',
          name: 'Charlie Brown',
          image: null,
          permissionType: 'read' as PermissionType,
        },
      ]
      mockDb.orderBy.mockResolvedValue(mockResults)

      const result = await getUsersWithPermissions('workspace456')

      expect(result).toEqual([
        {
          userId: 'user1',
          email: 'alice@example.com',
          name: 'Alice Smith',
          image: 'https://example.com/alice.jpg',
          permissionType: 'admin',
        },
        {
          userId: 'user2',
          email: 'bob@example.com',
          name: 'Bob Johnson',
          image: 'https://example.com/bob.jpg',
          permissionType: 'write',
        },
        {
          userId: 'user3',
          email: 'charlie@example.com',
          name: 'Charlie Brown',
          image: null,
          permissionType: 'read',
        },
      ])
      expect(mockDb.select).toHaveBeenCalledWith({
        userId: user.id,
        email: user.email,
        name: user.name,
        image: user.image,
        permissionType: permissions.permissionType,
      })
      expect(mockDb.from).toHaveBeenCalledWith(permissions)
      expect(mockDb.innerJoin).toHaveBeenCalledWith(user, 'eq-condition')
      expect(mockDb.where).toHaveBeenCalledWith('and-condition')
      expect(mockDb.orderBy).toHaveBeenCalledWith(user.email)
    })

    it.concurrent('should handle single user with permission', async () => {
      const mockResults = [
        {
          userId: 'solo-user',
          email: 'solo@example.com',
          name: 'Solo User',
          image: 'https://example.com/solo.jpg',
          permissionType: 'admin' as PermissionType,
        },
      ]
      mockDb.orderBy.mockResolvedValue(mockResults)

      const result = await getUsersWithPermissions('workspace-solo')

      expect(result).toEqual([
        {
          userId: 'solo-user',
          email: 'solo@example.com',
          name: 'Solo User',
          image: 'https://example.com/solo.jpg',
          permissionType: 'admin',
        },
      ])
    })

    it.concurrent('should handle users with null names and images', async () => {
      const mockResults = [
        {
          userId: 'user-minimal',
          email: 'minimal@example.com',
          name: null,
          image: null,
          permissionType: 'read' as PermissionType,
        },
      ]
      mockDb.orderBy.mockResolvedValue(mockResults)

      const result = await getUsersWithPermissions('workspace-minimal')

      expect(result).toEqual([
        {
          userId: 'user-minimal',
          email: 'minimal@example.com',
          name: null,
          image: null,
          permissionType: 'read',
        },
      ])
    })

    it.concurrent('should call database with correct parameters', async () => {
      mockDb.orderBy.mockResolvedValue([])

      await getUsersWithPermissions('test-workspace-123')

      expect(mockDb.select).toHaveBeenCalledWith({
        userId: user.id,
        email: user.email,
        name: user.name,
        image: user.image,
        permissionType: permissions.permissionType,
      })
      expect(mockDb.from).toHaveBeenCalledWith(permissions)
      expect(mockDb.innerJoin).toHaveBeenCalledWith(user, 'eq-condition')
      expect(mockDb.where).toHaveBeenCalledWith('and-condition')
      expect(mockDb.orderBy).toHaveBeenCalledWith(user.email)
    })

    it.concurrent('should handle different workspace IDs', async () => {
      mockDb.orderBy.mockResolvedValue([])

      const result1 = await getUsersWithPermissions('workspace-abc-123')
      const result2 = await getUsersWithPermissions('workspace-xyz-789')

      expect(result1).toEqual([])
      expect(result2).toEqual([])
      expect(mockDb.select).toHaveBeenCalled()
      expect(mockDb.from).toHaveBeenCalled()
      expect(mockDb.innerJoin).toHaveBeenCalled()
      expect(mockDb.where).toHaveBeenCalled()
      expect(mockDb.orderBy).toHaveBeenCalled()
    })

    it.concurrent('should handle all permission types correctly', async () => {
      const mockResults = [
        {
          userId: 'admin-user',
          email: 'admin@example.com',
          name: 'Admin User',
          image: 'admin.jpg',
          permissionType: 'admin' as PermissionType,
        },
        {
          userId: 'write-user',
          email: 'writer@example.com',
          name: 'Write User',
          image: 'writer.jpg',
          permissionType: 'write' as PermissionType,
        },
        {
          userId: 'read-user',
          email: 'reader@example.com',
          name: 'Read User',
          image: 'reader.jpg',
          permissionType: 'read' as PermissionType,
        },
      ]
      mockDb.orderBy.mockResolvedValue(mockResults)

      const result = await getUsersWithPermissions('workspace-all-perms')

      expect(result).toHaveLength(3)
      expect(result[0].permissionType).toBe('admin')
      expect(result[1].permissionType).toBe('write')
      expect(result[2].permissionType).toBe('read')
    })

    it.concurrent('should handle empty workspace ID', async () => {
      mockDb.orderBy.mockResolvedValue([])

      const result = await getUsersWithPermissions('')

      expect(result).toEqual([])
      expect(mockDb.select).toHaveBeenCalled()
    })
  })
})

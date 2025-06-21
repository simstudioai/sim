import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getUserEntityPermissions } from './utils'

// Mock the imports - all mock objects must be inside the factory functions
vi.mock('@/db', () => ({
  db: {
    select: vi.fn(),
    from: vi.fn(),
    where: vi.fn(),
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
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn().mockReturnValue('and-condition'),
  eq: vi.fn().mockReturnValue('eq-condition'),
}))

// Define the enum type for testing
type PermissionType = 'admin' | 'write' | 'read'

describe('Permission Utils', () => {
  // Get the mocked modules
  let mockDb: any
  let mockPermissions: any

  beforeEach(async () => {
    vi.clearAllMocks()

    // Import the mocked modules
    const { db } = await import('@/db')
    const { permissions } = await import('@/db/schema')

    mockDb = db
    mockPermissions = permissions

    // Setup default mock chain
    mockDb.select.mockReturnValue(mockDb)
    mockDb.from.mockReturnValue(mockDb)
    mockDb.where.mockResolvedValue([])
  })

  describe('getUserEntityPermissions', () => {
    it('should return null when user has no permissions', async () => {
      mockDb.where.mockResolvedValue([])

      const result = await getUserEntityPermissions('user123', 'workspace', 'workspace456')

      expect(result).toBeNull()
      expect(mockDb.select).toHaveBeenCalledWith({ permissionType: mockPermissions.permissionType })
      expect(mockDb.from).toHaveBeenCalledWith(mockPermissions)
      expect(mockDb.where).toHaveBeenCalledWith('and-condition')
    })

    it('should return the highest permission when user has multiple permissions', async () => {
      const mockResults = [
        { permissionType: 'read' as PermissionType },
        { permissionType: 'admin' as PermissionType },
        { permissionType: 'write' as PermissionType },
      ]
      mockDb.where.mockResolvedValue(mockResults)

      const result = await getUserEntityPermissions('user123', 'workspace', 'workspace456')

      expect(result).toBe('admin')
      expect(mockDb.select).toHaveBeenCalledWith({ permissionType: mockPermissions.permissionType })
      expect(mockDb.from).toHaveBeenCalledWith(mockPermissions)
    })

    it('should return single permission when user has only one', async () => {
      const mockResults = [{ permissionType: 'read' as PermissionType }]
      mockDb.where.mockResolvedValue(mockResults)

      const result = await getUserEntityPermissions('user123', 'workflow', 'workflow789')

      expect(result).toBe('read')
    })

    it('should handle different entity types', async () => {
      const mockResults = [{ permissionType: 'write' as PermissionType }]
      mockDb.where.mockResolvedValue(mockResults)

      const result = await getUserEntityPermissions('user456', 'organization', 'org123')

      expect(result).toBe('write')
    })

    it('should return highest permission when multiple exist (admin > write > read)', async () => {
      const mockResults = [
        { permissionType: 'read' as PermissionType },
        { permissionType: 'write' as PermissionType },
      ]
      mockDb.where.mockResolvedValue(mockResults)

      const result = await getUserEntityPermissions('user789', 'workspace', 'workspace123')

      expect(result).toBe('write')
    })

    it('should prioritize admin over other permissions', async () => {
      const mockResults = [
        { permissionType: 'write' as PermissionType },
        { permissionType: 'admin' as PermissionType },
        { permissionType: 'read' as PermissionType },
      ]
      mockDb.where.mockResolvedValue(mockResults)

      const result = await getUserEntityPermissions('user999', 'workspace', 'workspace999')

      expect(result).toBe('admin')
    })

    it('should handle edge case with single admin permission', async () => {
      const mockResults = [{ permissionType: 'admin' as PermissionType }]
      mockDb.where.mockResolvedValue(mockResults)

      const result = await getUserEntityPermissions('admin-user', 'workspace', 'workspace-admin')

      expect(result).toBe('admin')
    })

    it('should correctly prioritize write over read', async () => {
      const mockResults = [
        { permissionType: 'read' as PermissionType },
        { permissionType: 'write' as PermissionType },
        { permissionType: 'read' as PermissionType }, // duplicate to test deduplication logic
      ]
      mockDb.where.mockResolvedValue(mockResults)

      const result = await getUserEntityPermissions('write-user', 'workflow', 'workflow-write')

      expect(result).toBe('write')
    })
  })
})

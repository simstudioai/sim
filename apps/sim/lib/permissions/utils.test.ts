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
    enumValues: ['admin', 'read', 'edit', 'deploy'],
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn().mockReturnValue('and-condition'),
  eq: vi.fn().mockReturnValue('eq-condition'),
}))

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
    it('should return empty array when user has no permissions', async () => {
      mockDb.where.mockResolvedValue([])

      const result = await getUserEntityPermissions('user123', 'workspace', 'workspace456')

      expect(result).toEqual([])
      expect(mockDb.select).toHaveBeenCalledWith({ permissionType: mockPermissions.permissionType })
      expect(mockDb.from).toHaveBeenCalledWith(mockPermissions)
      expect(mockDb.where).toHaveBeenCalledWith('and-condition')
    })

    it('should return user permissions for the entity', async () => {
      const mockResults = [
        { permissionType: 'admin' },
        { permissionType: 'read' },
        { permissionType: 'edit' },
      ]
      mockDb.where.mockResolvedValue(mockResults)

      const result = await getUserEntityPermissions('user123', 'workspace', 'workspace456')

      expect(result).toEqual(['admin', 'read', 'edit'])
      expect(mockDb.select).toHaveBeenCalledWith({ permissionType: mockPermissions.permissionType })
      expect(mockDb.from).toHaveBeenCalledWith(mockPermissions)
    })

    it('should return single permission when user has only one', async () => {
      const mockResults = [{ permissionType: 'read' }]
      mockDb.where.mockResolvedValue(mockResults)

      const result = await getUserEntityPermissions('user123', 'workflow', 'workflow789')

      expect(result).toEqual(['read'])
    })

    it('should handle different entity types', async () => {
      const mockResults = [{ permissionType: 'deploy' }]
      mockDb.where.mockResolvedValue(mockResults)

      const result = await getUserEntityPermissions('user456', 'organization', 'org123')

      expect(result).toEqual(['deploy'])
    })
  })
})

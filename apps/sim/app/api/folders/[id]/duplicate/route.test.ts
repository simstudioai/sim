/**
 * Tests for folder duplicate API route (/api/folders/[id]/duplicate)
 *
 * @vitest-environment node
 */
import { auditMock, createMockRequest, type MockUser } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockGetUserEntityPermissions, mockLogger, mockDbRef, mockDuplicateWorkflow } =
  vi.hoisted(() => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      fatal: vi.fn(),
      child: vi.fn(),
    }
    return {
      mockGetSession: vi.fn(),
      mockGetUserEntityPermissions: vi.fn(),
      mockLogger: logger,
      mockDbRef: { current: null as any },
      mockDuplicateWorkflow: vi.fn(),
    }
  })

vi.mock('@/lib/audit/log', () => auditMock)
vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))
vi.mock('@sim/logger', () => ({
  createLogger: vi.fn().mockReturnValue(mockLogger),
}))
vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getUserEntityPermissions: mockGetUserEntityPermissions,
}))
vi.mock('@/lib/workflows/persistence/duplicate', () => ({
  duplicateWorkflow: mockDuplicateWorkflow,
}))
vi.mock('@sim/db', () => ({
  get db() {
    return mockDbRef.current
  },
}))

import { POST } from '@/app/api/folders/[id]/duplicate/route'

const TEST_USER: MockUser = {
  id: 'user-123',
  email: 'test@example.com',
  name: 'Test User',
}

const SOURCE_WORKSPACE_ID = 'workspace-source'
const TARGET_WORKSPACE_ID = 'workspace-target'

const mockFolder = {
  id: 'folder-1',
  name: 'Source Folder',
  userId: TEST_USER.id,
  workspaceId: SOURCE_WORKSPACE_ID,
  parentId: null,
  color: '#6B7280',
  sortOrder: 1,
  isExpanded: false,
  createdAt: new Date('2024-01-01T00:00:00Z'),
  updatedAt: new Date('2024-01-01T00:00:00Z'),
}

function createDuplicateDbMock(options: { folderLookupResult?: any; throwError?: boolean } = {}) {
  const { folderLookupResult = mockFolder, throwError = false } = options

  const mockSelect = vi.fn().mockImplementation(() => ({
    from: vi.fn().mockImplementation(() => ({
      where: vi.fn().mockImplementation(() => ({
        then: vi.fn().mockImplementation((callback) => {
          if (throwError) {
            throw new Error('Database error')
          }
          const result = folderLookupResult ? [folderLookupResult] : []
          return Promise.resolve(callback(result))
        }),
      })),
    })),
  }))

  const mockTransactionInsert = vi.fn().mockReturnValue({
    values: vi.fn().mockResolvedValue(undefined),
  })

  const minSelectMock = vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([{ minSortOrder: 0 }]),
    }),
  })

  const txMock = {
    select: minSelectMock,
    insert: mockTransactionInsert,
  }

  const mockTransaction = vi.fn().mockImplementation(async (fn: any) => {
    return fn(txMock)
  })

  return {
    select: mockSelect,
    transaction: mockTransaction,
  }
}

function mockAuthenticatedUser(user?: MockUser) {
  mockGetSession.mockResolvedValue({ user: user || TEST_USER })
}

function mockUnauthenticated() {
  mockGetSession.mockResolvedValue(null)
}

describe('Folder Duplicate API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUserEntityPermissions.mockResolvedValue('admin')
    mockDbRef.current = createDuplicateDbMock()
    mockDuplicateWorkflow.mockResolvedValue({
      id: 'new-workflow-1',
      name: 'Duplicated Workflow',
    })
  })

  describe('POST /api/folders/[id]/duplicate', () => {
    it('should reject unauthenticated requests', async () => {
      mockUnauthenticated()

      const req = createMockRequest('POST', {
        name: 'Duplicate Folder',
      })
      const params = Promise.resolve({ id: 'folder-1' })

      const response = await POST(req as any, { params })

      expect(response.status).toBe(401)
    })

    it('should reject when user has read-only access to source workspace', async () => {
      mockAuthenticatedUser()
      mockGetUserEntityPermissions.mockResolvedValue('read')

      const req = createMockRequest('POST', {
        name: 'Duplicate Folder',
      })
      const params = Promise.resolve({ id: 'folder-1' })

      const response = await POST(req as any, { params })

      expect(response.status).toBe(403)
    })

    it('should reject when user lacks access to a different target workspace', async () => {
      mockAuthenticatedUser()

      mockGetUserEntityPermissions
        .mockResolvedValueOnce('admin') // source workspace check
        .mockResolvedValueOnce('read') // target workspace check - read only

      const req = createMockRequest('POST', {
        name: 'Duplicate Folder',
        workspaceId: TARGET_WORKSPACE_ID,
      })
      const params = Promise.resolve({ id: 'folder-1' })

      const response = await POST(req as any, { params })

      expect(response.status).toBe(403)
      const data = await response.json()
      expect(data.error).toBe('Write or admin access required for target workspace')
    })

    it('should reject when user has no permission on target workspace', async () => {
      mockAuthenticatedUser()

      mockGetUserEntityPermissions
        .mockResolvedValueOnce('admin') // source workspace check
        .mockResolvedValueOnce(null) // target workspace check - no access

      const req = createMockRequest('POST', {
        name: 'Duplicate Folder',
        workspaceId: TARGET_WORKSPACE_ID,
      })
      const params = Promise.resolve({ id: 'folder-1' })

      const response = await POST(req as any, { params })

      expect(response.status).toBe(403)
    })

    it('should not check target workspace permission when duplicating within same workspace', async () => {
      mockAuthenticatedUser()
      mockGetUserEntityPermissions.mockResolvedValue('admin')

      const req = createMockRequest('POST', {
        name: 'Duplicate Folder',
      })
      const params = Promise.resolve({ id: 'folder-1' })

      await POST(req as any, { params })

      expect(mockGetUserEntityPermissions).toHaveBeenCalledTimes(1)
      expect(mockGetUserEntityPermissions).toHaveBeenCalledWith(
        TEST_USER.id,
        'workspace',
        SOURCE_WORKSPACE_ID
      )
    })

    it('should check target workspace permission when workspaceId differs', async () => {
      mockAuthenticatedUser()
      mockGetUserEntityPermissions.mockResolvedValue('admin')

      const req = createMockRequest('POST', {
        name: 'Duplicate Folder',
        workspaceId: TARGET_WORKSPACE_ID,
      })
      const params = Promise.resolve({ id: 'folder-1' })

      await POST(req as any, { params })

      expect(mockGetUserEntityPermissions).toHaveBeenCalledTimes(2)
      expect(mockGetUserEntityPermissions).toHaveBeenCalledWith(
        TEST_USER.id,
        'workspace',
        TARGET_WORKSPACE_ID
      )
    })
  })
})

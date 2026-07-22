/**
 * Tests for knowledge base API route
 *
 * @vitest-environment node
 */
import {
  auditMock,
  authMockFns,
  createMockRequest,
  dbChainMock,
  dbChainMockFns,
  permissionsMock,
  permissionsMockFns,
  resetDbChainMock,
} from '@sim/testing'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db', () => dbChainMock)

vi.mock('@sim/audit', () => auditMock)

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

import { GET, POST } from '@/app/api/knowledge/route'

describe('Knowledge Base API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()

    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('admin')

    vi.stubGlobal('crypto', {
      randomUUID: vi.fn().mockReturnValue('mock-uuid-1234-5678'),
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  afterAll(() => {
    resetDbChainMock()
  })

  describe('GET /api/knowledge', () => {
    it('should return unauthorized for unauthenticated user', async () => {
      authMockFns.mockGetSession.mockResolvedValue(null)

      const req = createMockRequest('GET')
      const response = await GET(req)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should handle database errors', async () => {
      authMockFns.mockGetSession.mockResolvedValue({
        user: { id: 'user-123', email: 'test@example.com' },
      })
      dbChainMockFns.orderBy.mockRejectedValueOnce(new Error('Database error'))

      const req = createMockRequest('GET')
      const response = await GET(req)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to fetch knowledge bases')
    })
  })

  describe('POST /api/knowledge', () => {
    const validKnowledgeBaseData = {
      name: 'Test Knowledge Base',
      description: 'Test description',
      workspaceId: 'test-workspace-id',
      chunkingConfig: {
        maxSize: 1024,
        minSize: 100,
        overlap: 200,
      },
    }

    it('should create knowledge base successfully', async () => {
      authMockFns.mockGetSession.mockResolvedValue({
        user: { id: 'user-123', email: 'test@example.com' },
      })

      const req = createMockRequest('POST', validKnowledgeBaseData)
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.data.name).toBe(validKnowledgeBaseData.name)
      expect(data.data.description).toBe(validKnowledgeBaseData.description)
      expect(dbChainMockFns.insert).toHaveBeenCalled()
    })

    it('should return unauthorized for unauthenticated user', async () => {
      authMockFns.mockGetSession.mockResolvedValue(null)

      const req = createMockRequest('POST', validKnowledgeBaseData)
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should validate required fields', async () => {
      authMockFns.mockGetSession.mockResolvedValue({
        user: { id: 'user-123', email: 'test@example.com' },
      })

      const req = createMockRequest('POST', { description: 'Missing name' })
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Invalid request data')
      expect(data.details).toBeDefined()
    })

    it('should require workspaceId', async () => {
      authMockFns.mockGetSession.mockResolvedValue({
        user: { id: 'user-123', email: 'test@example.com' },
      })

      const req = createMockRequest('POST', { name: 'Test KB' })
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Invalid request data')
      expect(data.details).toBeDefined()
    })

    it('returns 403 when user lacks permission on target workspace', async () => {
      authMockFns.mockGetSession.mockResolvedValue({
        user: { id: 'attacker', email: 'a@example.com' },
      })
      permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValueOnce('read')

      const req = createMockRequest('POST', validKnowledgeBaseData)
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(403)
      expect(data.error).toBe(
        'User does not have permission to create knowledge bases in this workspace'
      )
      expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    })

    it('should validate chunking config constraints', async () => {
      authMockFns.mockGetSession.mockResolvedValue({
        user: { id: 'user-123', email: 'test@example.com' },
      })

      const invalidData = {
        name: 'Test KB',
        workspaceId: 'test-workspace-id',
        chunkingConfig: {
          maxSize: 100, // 100 tokens = 400 characters
          minSize: 500, // Invalid: minSize (500 chars) > maxSize (400 chars)
          overlap: 50,
        },
      }

      const req = createMockRequest('POST', invalidData)
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Invalid request data')
    })

    it('should use default values for optional fields', async () => {
      authMockFns.mockGetSession.mockResolvedValue({
        user: { id: 'user-123', email: 'test@example.com' },
      })

      const minimalData = { name: 'Test KB', workspaceId: 'test-workspace-id' }
      const req = createMockRequest('POST', minimalData)
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.data.embeddingModel).toBe('text-embedding-3-small')
      expect(data.data.embeddingDimension).toBe(1536)
      expect(data.data.chunkingConfig).toEqual({
        maxSize: 1024,
        minSize: 100,
        overlap: 200,
      })
    })

    it('should handle database errors during creation', async () => {
      authMockFns.mockGetSession.mockResolvedValue({
        user: { id: 'user-123', email: 'test@example.com' },
      })
      dbChainMockFns.values.mockRejectedValueOnce(new Error('Database error'))

      const req = createMockRequest('POST', validKnowledgeBaseData)
      const response = await POST(req)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to create knowledge base')
    })
  })
})

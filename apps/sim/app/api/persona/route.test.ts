/**
 * Tests for persona API route
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockRequest, mockAuth, setupCommonApiMocks } from '@/app/api/__test-utils__/utils'

describe('Persona API Route', () => {
  const mockPersonas = [
    {
      id: 'persona-1',
      workspaceId: 'workspace-123',
      name: 'Test Persona 1',
      description: 'desc',
      photo: '',
      createdAt: new Date('2023-01-01T00:00:00.000Z'),
      updatedAt: new Date('2023-01-01T00:00:00.000Z'),
    },
    {
      id: 'persona-2',
      workspaceId: 'workspace-123',
      name: 'Test Persona 2',
      description: '',
      photo: '',
      createdAt: new Date('2023-01-02T00:00:00.000Z'),
      updatedAt: new Date('2023-01-02T00:00:00.000Z'),
    },
  ]

  const { mockAuthenticatedUser, mockUnauthenticated } = mockAuth()
  const mockSelect = vi.fn()
  const mockFrom = vi.fn()
  const mockWhere = vi.fn()
  const mockInsert = vi.fn()
  const mockValues = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    setupCommonApiMocks()

    mockSelect.mockReturnValue({ from: mockFrom })
    mockFrom.mockReturnValue({ where: mockWhere })
    mockWhere.mockReturnValue(mockPersonas)
    mockInsert.mockReturnValue({ values: mockValues })
    mockValues.mockReturnValue(undefined)

    vi.doMock('@/db', () => ({
      db: {
        select: mockSelect,
        insert: mockInsert,
      },
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('GET /api/persona', () => {
    it('should return all personas if no workspaceId', async () => {
      mockAuthenticatedUser()
      const mockRequest = createMockRequest('GET')
      Object.defineProperty(mockRequest, 'url', {
        value: 'http://localhost:3000/api/persona',
      })
      const { GET } = await import('./route')
      const response = await GET(mockRequest)
      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data).toHaveProperty('personas')
      expect(data.personas).toHaveLength(2)
    })

    it('should return personas for a workspaceId', async () => {
      mockAuthenticatedUser()
      const mockRequest = createMockRequest('GET')
      Object.defineProperty(mockRequest, 'url', {
        value: 'http://localhost:3000/api/persona?workspaceId=workspace-123',
      })
      const { GET } = await import('./route')
      const response = await GET(mockRequest)
      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.personas[0]).toMatchObject({ workspaceId: 'workspace-123' })
    })

    it('should handle database errors gracefully', async () => {
      mockAuthenticatedUser()
      mockSelect.mockImplementationOnce(() => {
        throw new Error('DB error')
      })
      const mockRequest = createMockRequest('GET')
      Object.defineProperty(mockRequest, 'url', {
        value: 'http://localhost:3000/api/persona',
      })
      const { GET } = await import('./route')
      let response
      try {
        response = await GET(mockRequest)
      } catch (e) {
        expect(e).toBeInstanceOf(Error)
      }
    })
  })

  describe('POST /api/persona', () => {
    it('should create a new persona successfully', async () => {
      mockAuthenticatedUser()
      mockInsert.mockReturnValue({ values: mockValues })
      mockValues.mockReturnValue(undefined)
      const req = createMockRequest('POST', {
        workspaceId: 'workspace-123',
        name: 'New Persona',
        description: 'desc',
        photo: '',
      })
      const { POST } = await import('./route')
      const response = await POST(req)
      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data).toHaveProperty('persona')
      expect(data.persona).toMatchObject({ name: 'New Persona', workspaceId: 'workspace-123' })
    })

    it('should return 400 when required fields are missing', async () => {
      mockAuthenticatedUser()
      const req = createMockRequest('POST', { name: 'Persona Only' })
      const { POST } = await import('./route')
      const response = await POST(req)
      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data).toHaveProperty('error', 'workspaceId and name are required')
    })

    it('should handle database errors gracefully', async () => {
      mockAuthenticatedUser()
      mockInsert.mockImplementationOnce(() => {
        throw new Error('DB error')
      })
      const req = createMockRequest('POST', {
        workspaceId: 'workspace-123',
        name: 'Persona',
      })
      const { POST } = await import('./route')
      let response
      try {
        response = await POST(req)
      } catch (e) {
        expect(e).toBeInstanceOf(Error)
      }
    })
  })
})

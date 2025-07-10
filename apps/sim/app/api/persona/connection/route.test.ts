/**
 * Tests for persona/connection API route
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockRequest, mockAuth, setupCommonApiMocks } from '@/app/api/__test-utils__/utils'

describe('Persona Connection API Route', () => {
  const mockConnection = {
    id: 'conn-1',
    personaId: 'persona-1',
    connectedPersonaId: 'persona-2',
  }

  const { mockAuthenticatedUser } = mockAuth()
  const mockSelect = vi.fn()
  const mockFrom = vi.fn()
  const mockWhere = vi.fn()
  const mockInsert = vi.fn()
  const mockValues = vi.fn()
  const mockDelete = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    setupCommonApiMocks()

    mockSelect.mockReturnValue({ from: mockFrom })
    mockFrom.mockReturnValue({ where: mockWhere })
    mockWhere.mockReturnValue([mockConnection])
    mockInsert.mockReturnValue({ values: mockValues })
    mockValues.mockReturnValue(undefined)
    mockDelete.mockReturnValue({ where: vi.fn().mockReturnValue(undefined) })

    vi.doMock('@/db', () => ({
      db: {
        select: mockSelect,
        insert: mockInsert,
        delete: mockDelete,
      },
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('POST /api/persona/connection', () => {
    it('should create a new connection', async () => {
      mockAuthenticatedUser()
      const req = createMockRequest('POST', {
        personaId: 'persona-1',
        connectedPersonaId: 'persona-2',
      })
      const { POST } = await import('./route')
      const response = await POST(req)
      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data).toHaveProperty('connection')
      expect(data.connection).toMatchObject({
        personaId: 'persona-1',
        connectedPersonaId: 'persona-2',
      })
    })
    it('should return 400 if required fields are missing', async () => {
      mockAuthenticatedUser()
      const req = createMockRequest('POST', { personaId: 'persona-1' })
      const { POST } = await import('./route')
      const response = await POST(req)
      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data).toHaveProperty('error', 'personaId and connectedPersonaId are required')
    })
  })

  describe('DELETE /api/persona/connection', () => {
    it('should delete a connection', async () => {
      mockAuthenticatedUser()
      const req = createMockRequest('DELETE', {
        personaId: 'persona-1',
        connectedPersonaId: 'persona-2',
      })
      const { DELETE } = await import('./route')
      const response = await DELETE(req)
      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data).toHaveProperty('success', true)
    })
    it('should return 400 if required fields are missing', async () => {
      mockAuthenticatedUser()
      const req = createMockRequest('DELETE', { personaId: 'persona-1' })
      const { DELETE } = await import('./route')
      const response = await DELETE(req)
      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data).toHaveProperty('error', 'personaId and connectedPersonaId are required')
    })
  })

  describe('GET /api/persona/connection', () => {
    it('should return connections for a persona', async () => {
      mockAuthenticatedUser()
      const mockRequest = createMockRequest('GET')
      Object.defineProperty(mockRequest, 'url', {
        value: 'http://localhost:3000/api/persona/connection?personaId=persona-1',
      })
      const { GET } = await import('./route')
      const response = await GET(mockRequest)
      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data).toHaveProperty('connections')
    })
    it('should return 400 if personaId is missing', async () => {
      mockAuthenticatedUser()
      const mockRequest = createMockRequest('GET')
      Object.defineProperty(mockRequest, 'url', {
        value: 'http://localhost:3000/api/persona/connection',
      })
      const { GET } = await import('./route')
      const response = await GET(mockRequest)
      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data).toHaveProperty('error', 'personaId required')
    })
  })
})

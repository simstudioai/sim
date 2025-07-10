/**
 * Tests for persona/[id] API route
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockRequest, mockAuth, setupCommonApiMocks } from '@/app/api/__test-utils__/utils'

describe('Persona [id] API Route', () => {
  const mockPersona = {
    id: 'persona-1',
    workspaceId: 'workspace-123',
    name: 'Test Persona',
    description: 'desc',
    photo: '',
    createdAt: new Date('2023-01-01T00:00:00.000Z'),
    updatedAt: new Date('2023-01-01T00:00:00.000Z'),
  }

  const { mockAuthenticatedUser } = mockAuth()
  const mockSelect = vi.fn()
  const mockFrom = vi.fn()
  const mockWhere = vi.fn()
  const mockUpdate = vi.fn()
  const mockSet = vi.fn()
  const mockDelete = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    setupCommonApiMocks()

    mockSelect.mockReturnValue({ from: mockFrom })
    mockFrom.mockReturnValue({ where: mockWhere })
    mockWhere.mockReturnValue([mockPersona])
    mockUpdate.mockReturnValue({ set: mockSet })
    mockSet.mockReturnValue({ where: vi.fn().mockReturnValue(undefined) })
    mockDelete.mockReturnValue({ where: vi.fn().mockReturnValue(undefined) })

    vi.doMock('@/db', () => ({
      db: {
        select: mockSelect,
        update: mockUpdate,
        delete: mockDelete,
      },
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('GET /api/persona/[id]', () => {
    it('should return persona by id', async () => {
      mockAuthenticatedUser()
      const mockRequest = createMockRequest('GET')
      const { GET } = await import('./route')
      const response = await GET(mockRequest, { params: { id: 'persona-1' } })
      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data).toHaveProperty('persona')
      expect(data.persona).toMatchObject({ id: 'persona-1' })
    })
    it('should return 404 if persona not found', async () => {
      mockAuthenticatedUser()
      mockWhere.mockReturnValue([])
      const mockRequest = createMockRequest('GET')
      const { GET } = await import('./route')
      const response = await GET(mockRequest, { params: { id: 'not-found' } })
      expect(response.status).toBe(404)
      const data = await response.json()
      expect(data).toHaveProperty('error', 'Not found')
    })
  })

  describe('PUT /api/persona/[id]', () => {
    it('should update persona by id', async () => {
      mockAuthenticatedUser()
      const req = createMockRequest('PUT', {
        name: 'Updated',
        description: 'desc',
        photo: '',
      })
      const { PUT } = await import('./route')
      const response = await PUT(req, { params: { id: 'persona-1' } })
      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data).toHaveProperty('success', true)
    })
  })

  describe('DELETE /api/persona/[id]', () => {
    it('should delete persona by id', async () => {
      mockAuthenticatedUser()
      const req = createMockRequest('DELETE')
      const { DELETE } = await import('./route')
      const response = await DELETE(req, { params: { id: 'persona-1' } })
      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data).toHaveProperty('success', true)
    })
  })
})

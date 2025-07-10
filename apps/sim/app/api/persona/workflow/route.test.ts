/**
 * Tests for persona/workflow API route
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockRequest, mockAuth, setupCommonApiMocks } from '@/app/api/__test-utils__/utils'

describe('Persona Workflow API Route', () => {
  const mockPersonaWorkflow = {
    id: 'pw-1',
    personaId: 'persona-1',
    workflowId: 'workflow-1',
    status: 'in progress',
  }

  const { mockAuthenticatedUser } = mockAuth()
  const mockSelect = vi.fn()
  const mockFrom = vi.fn()
  const mockWhere = vi.fn()
  const mockInsert = vi.fn()
  const mockValues = vi.fn()
  const mockUpdate = vi.fn()
  const mockSet = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    setupCommonApiMocks()

    mockSelect.mockReturnValue({ from: mockFrom })
    mockFrom.mockReturnValue({ where: mockWhere })
    mockWhere.mockReturnValue([mockPersonaWorkflow])
    mockInsert.mockReturnValue({ values: mockValues })
    mockValues.mockReturnValue(undefined)
    mockUpdate.mockReturnValue({ set: mockSet })
    mockSet.mockReturnValue({ where: vi.fn().mockReturnValue(undefined) })

    vi.doMock('@/db', () => ({
      db: {
        select: mockSelect,
        insert: mockInsert,
        update: mockUpdate,
      },
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('POST /api/persona/workflow', () => {
    it('should create a new personaWorkflow', async () => {
      mockAuthenticatedUser()
      const req = createMockRequest('POST', {
        personaId: 'persona-1',
        workflowId: 'workflow-1',
        status: 'in progress',
      })
      const { POST } = await import('./route')
      const response = await POST(req)
      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data).toHaveProperty('personaWorkflow')
      expect(data.personaWorkflow).toMatchObject({
        personaId: 'persona-1',
        workflowId: 'workflow-1',
      })
    })
    it('should return 400 if required fields are missing', async () => {
      mockAuthenticatedUser()
      const req = createMockRequest('POST', { personaId: 'persona-1' })
      const { POST } = await import('./route')
      const response = await POST(req)
      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data).toHaveProperty('error', 'personaId and workflowId are required')
    })
  })

  describe('PUT /api/persona/workflow', () => {
    it('should update personaWorkflow status', async () => {
      mockAuthenticatedUser()
      const req = createMockRequest('PUT', {
        personaWorkflowId: 'pw-1',
        status: 'done',
      })
      const { PUT } = await import('./route')
      const response = await PUT(req)
      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data).toHaveProperty('success', true)
    })
    it('should return 400 if required fields are missing', async () => {
      mockAuthenticatedUser()
      const req = createMockRequest('PUT', { personaWorkflowId: 'pw-1' })
      const { PUT } = await import('./route')
      const response = await PUT(req)
      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data).toHaveProperty('error', 'personaWorkflowId and status are required')
    })
  })

  describe('GET /api/persona/workflow', () => {
    it('should return workflows for a persona', async () => {
      mockAuthenticatedUser()
      const mockRequest = createMockRequest('GET')
      Object.defineProperty(mockRequest, 'url', {
        value: 'http://localhost:3000/api/persona/workflow?personaId=persona-1',
      })
      const { GET } = await import('./route')
      const response = await GET(mockRequest)
      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data).toHaveProperty('workflows')
    })
    it('should return 400 if personaId is missing', async () => {
      mockAuthenticatedUser()
      const mockRequest = createMockRequest('GET')
      Object.defineProperty(mockRequest, 'url', {
        value: 'http://localhost:3000/api/persona/workflow',
      })
      const { GET } = await import('./route')
      const response = await GET(mockRequest)
      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data).toHaveProperty('error', 'personaId required')
    })
  })
})

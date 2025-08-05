/**
 * Tests for next available slot API route
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMockRequest,
  mockAuth,
  mockConsoleLogger,
  mockDrizzleOrm,
  mockKnowledgeSchemas,
} from '@/app/api/__test-utils__/utils'

mockKnowledgeSchemas()
mockDrizzleOrm()
mockConsoleLogger()

const mockAuth$ = mockAuth()

// Mock the permissions check
vi.mock('@/app/api/knowledge/utils', () => ({
  checkKnowledgeBaseAccess: vi.fn(),
}))

describe('/api/knowledge/[id]/next-available-slot', () => {
  const { mockDbChain, mockSelect, mockFrom, mockWhere } = vi.hoisted(() => {
    const mockWhere = vi.fn()
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere })
    const mockSelect = vi.fn().mockReturnValue({ from: mockFrom })
    const mockDbChain = { select: mockSelect }
    return { mockDbChain, mockSelect, mockFrom, mockWhere }
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth$.mockAuthenticatedUser()
  })

  afterEach(() => {
    vi.resetModules()
  })

  describe('GET /api/knowledge/[id]/next-available-slot', () => {
    it('should return next available slot when slots are available for text type', async () => {
      const { checkKnowledgeBaseAccess } = await import('@/app/api/knowledge/utils')

      // Mock permissions check
      vi.mocked(checkKnowledgeBaseAccess).mockResolvedValue({
        hasAccess: true,
        notFound: false,
        reason: '',
      })

      // Mock existing tag definitions (tag1 and tag3 are used for 'text' type)
      mockWhere.mockResolvedValue([{ tagSlot: 'tag1' }, { tagSlot: 'tag3' }])

      const req = createMockRequest('GET')
      Object.defineProperty(req, 'url', {
        value: 'http://localhost:3000/api/knowledge/kb-123/next-available-slot?fieldType=text',
      })
      const params = Promise.resolve({ id: 'kb-123' })

      const { GET } = await import('@/app/api/knowledge/[id]/next-available-slot/route')
      const response = await GET(req, { params })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.data.nextAvailableSlot).toBe('tag2') // First available slot
      expect(data.data.fieldType).toBe('text')
      expect(data.data.usedSlots).toEqual(['tag1', 'tag3'])
      expect(data.data.totalSlots).toBe(7)
      expect(data.data.availableSlots).toBe(5)
    })

    it('should return null when all slots are used', async () => {
      const { checkKnowledgeBaseAccess } = await import('@/app/api/knowledge/utils')

      // Mock permissions check
      vi.mocked(checkKnowledgeBaseAccess).mockResolvedValue({
        hasAccess: true,
        notFound: false,
        reason: '',
      })

      // Mock all slots being used
      mockWhere.mockResolvedValue([
        { tagSlot: 'tag1' },
        { tagSlot: 'tag2' },
        { tagSlot: 'tag3' },
        { tagSlot: 'tag4' },
        { tagSlot: 'tag5' },
        { tagSlot: 'tag6' },
        { tagSlot: 'tag7' },
      ])

      const req = createMockRequest('GET')
      const params = Promise.resolve({ id: 'kb-123' })

      const { GET } = await import('@/app/api/knowledge/[id]/next-available-slot/route')
      const response = await GET(req, { params })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.data.nextAvailableSlot).toBe(null)
      expect(data.data.usedSlots).toHaveLength(7)
      expect(data.data.availableSlots).toBe(0)
    })

    it('should return first slot when no text slots are used', async () => {
      const { checkKnowledgeBaseAccess } = await import('@/app/api/knowledge/utils')

      // Mock permissions check
      vi.mocked(checkKnowledgeBaseAccess).mockResolvedValue({
        hasAccess: true,
        notFound: false,
        reason: '',
      })

      // Mock no existing tag definitions for 'text' type
      mockWhere.mockResolvedValue([])

      const req = createMockRequest('GET')
      Object.defineProperty(req, 'url', {
        value: 'http://localhost:3000/api/knowledge/kb-123/next-available-slot?fieldType=text',
      })
      const params = Promise.resolve({ id: 'kb-123' })

      const { GET } = await import('@/app/api/knowledge/[id]/next-available-slot/route')
      const response = await GET(req, { params })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.data.nextAvailableSlot).toBe('tag1')
      expect(data.data.fieldType).toBe('text')
      expect(data.data.usedSlots).toEqual([])
      expect(data.data.availableSlots).toBe(7)
    })

    it('should return null for unsupported field types (graceful failure)', async () => {
      const { checkKnowledgeBaseAccess } = await import('@/app/api/knowledge/utils')

      // Mock permissions check
      vi.mocked(checkKnowledgeBaseAccess).mockResolvedValue({
        hasAccess: true,
        notFound: false,
        reason: '',
      })

      // Mock no existing definitions (won't be called since no slots available)
      mockWhere.mockResolvedValue([])

      const req = createMockRequest('GET')
      Object.defineProperty(req, 'url', {
        value: 'http://localhost:3000/api/knowledge/kb-123/next-available-slot?fieldType=number',
      })
      const params = Promise.resolve({ id: 'kb-123' })

      const { GET } = await import('@/app/api/knowledge/[id]/next-available-slot/route')
      const response = await GET(req, { params })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.data.nextAvailableSlot).toBe(null) // No slots available for unsupported type
      expect(data.data.fieldType).toBe('number')
      expect(data.data.totalSlots).toBe(0) // getSlotsForFieldType returns empty array
      expect(data.data.availableSlots).toBe(0)
    })

    it('should return 403 when user lacks access', async () => {
      const { checkKnowledgeBaseAccess } = await import('@/app/api/knowledge/utils')

      // Mock permissions check failure
      vi.mocked(checkKnowledgeBaseAccess).mockResolvedValue({
        hasAccess: false,
        notFound: false,
        reason: 'Insufficient permissions',
      })

      const req = createMockRequest('GET')
      const params = Promise.resolve({ id: 'kb-123' })

      const { GET } = await import('@/app/api/knowledge/[id]/next-available-slot/route')
      const response = await GET(req, { params })
      const data = await response.json()

      expect(response.status).toBe(403)
      expect(data.error).toBe('Forbidden')
    })

    it('should return 401 when user is not authenticated', async () => {
      mockAuth$.mockUnauthenticatedUser()

      const req = createMockRequest('GET')
      Object.defineProperty(req, 'url', {
        value: 'http://localhost:3000/api/knowledge/kb-123/next-available-slot?fieldType=text',
      })
      const params = Promise.resolve({ id: 'kb-123' })

      const { GET } = await import('@/app/api/knowledge/[id]/next-available-slot/route')
      const response = await GET(req, { params })
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should return 400 when fieldType parameter is missing', async () => {
      const req = createMockRequest('GET')
      // No fieldType parameter in URL
      Object.defineProperty(req, 'url', {
        value: 'http://localhost:3000/api/knowledge/kb-123/next-available-slot',
      })
      const params = Promise.resolve({ id: 'kb-123' })

      const { GET } = await import('@/app/api/knowledge/[id]/next-available-slot/route')
      const response = await GET(req, { params })
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('fieldType parameter is required')
    })
  })
})

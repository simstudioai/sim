/**
 * Tests for knowledge base tag definitions API route
 *
 * @vitest-environment node
 */
import {
  createMockRequest,
  hybridAuthMockFns,
  knowledgeApiUtilsMock,
  knowledgeApiUtilsMockFns,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetTagDefinitions, mockCreateTagDefinition } = vi.hoisted(() => ({
  mockGetTagDefinitions: vi.fn(),
  mockCreateTagDefinition: vi.fn(),
}))

vi.mock('@/lib/knowledge/tags/service', () => ({
  getTagDefinitions: mockGetTagDefinitions,
  createTagDefinition: mockCreateTagDefinition,
}))

vi.mock('@/app/api/knowledge/utils', () => knowledgeApiUtilsMock)

import { GET, POST } from '@/app/api/knowledge/[id]/tag-definitions/route'

const KB_ID = 'kb-victim'
const TAG_DEFINITIONS = [
  { id: 'tag-def-1', tagSlot: 'tag1', displayName: 'Client Name', fieldType: 'text' },
]
const CREATE_BODY = { tagSlot: 'tag1', displayName: 'Injected', fieldType: 'text' }

const params = () => ({ params: Promise.resolve({ id: KB_ID }) })

const { mockCheckKnowledgeBaseAccess, mockCheckKnowledgeBaseWriteAccess } = knowledgeApiUtilsMockFns

/** Stubs the auth result the route sees. Omit `userId` for a JWT with no acting user. */
function authenticateAs(userId?: string, authType = 'internal_jwt') {
  hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
    success: true,
    authType,
    ...(userId ? { userId } : {}),
  })
}

const granted = { hasAccess: true, knowledgeBase: { id: KB_ID, userId: 'user-1' } }

describe('Knowledge Base Tag Definitions API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetTagDefinitions.mockResolvedValue(TAG_DEFINITIONS)
    mockCreateTagDefinition.mockResolvedValue({ id: 'tag-def-new' })
  })

  describe('GET /api/knowledge/[id]/tag-definitions', () => {
    it('returns tag definitions to a caller with read access', async () => {
      authenticateAs('user-1', 'session')
      mockCheckKnowledgeBaseAccess.mockResolvedValue(granted)

      const response = await GET(createMockRequest('GET'), params())

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({ success: true, data: TAG_DEFINITIONS })
    })

    it('gates reads on read access, not write access', async () => {
      authenticateAs('user-1', 'session')
      mockCheckKnowledgeBaseAccess.mockResolvedValue(granted)

      await GET(createMockRequest('GET'), params())

      expect(mockCheckKnowledgeBaseAccess).toHaveBeenCalledWith(KB_ID, 'user-1')
      expect(mockCheckKnowledgeBaseWriteAccess).not.toHaveBeenCalled()
    })

    it('authorizes internal JWT callers instead of trusting them', async () => {
      authenticateAs('attacker-1')
      mockCheckKnowledgeBaseAccess.mockResolvedValue({ hasAccess: false })

      const response = await GET(createMockRequest('GET'), params())

      expect(response.status).toBe(403)
      expect(mockCheckKnowledgeBaseAccess).toHaveBeenCalledWith(KB_ID, 'attacker-1')
      expect(mockGetTagDefinitions).not.toHaveBeenCalled()
    })

    it('returns 404 for an unknown knowledge base', async () => {
      authenticateAs('attacker-1')
      mockCheckKnowledgeBaseAccess.mockResolvedValue({ hasAccess: false, notFound: true })

      const response = await GET(createMockRequest('GET'), params())

      expect(response.status).toBe(404)
      expect(mockGetTagDefinitions).not.toHaveBeenCalled()
    })

    it('rejects a JWT that carries no acting user', async () => {
      authenticateAs()

      const response = await GET(createMockRequest('GET'), params())

      expect(response.status).toBe(401)
      expect(mockCheckKnowledgeBaseAccess).not.toHaveBeenCalled()
      expect(mockGetTagDefinitions).not.toHaveBeenCalled()
    })
  })

  describe('POST /api/knowledge/[id]/tag-definitions', () => {
    it('creates a tag definition for a caller with write access', async () => {
      authenticateAs('user-1', 'session')
      mockCheckKnowledgeBaseWriteAccess.mockResolvedValue(granted)

      const response = await POST(createMockRequest('POST', CREATE_BODY), params())

      expect(response.status).toBe(200)
      expect(mockCreateTagDefinition).toHaveBeenCalledWith(
        expect.objectContaining({ knowledgeBaseId: KB_ID, tagSlot: 'tag1' }),
        expect.any(String)
      )
    })

    it('authorizes internal JWT callers instead of trusting them', async () => {
      authenticateAs('attacker-1')
      mockCheckKnowledgeBaseWriteAccess.mockResolvedValue({ hasAccess: false })

      const response = await POST(createMockRequest('POST', CREATE_BODY), params())

      expect(response.status).toBe(403)
      expect(mockCheckKnowledgeBaseWriteAccess).toHaveBeenCalledWith(KB_ID, 'attacker-1')
      expect(mockCreateTagDefinition).not.toHaveBeenCalled()
    })

    it('rejects a JWT that carries no acting user', async () => {
      authenticateAs()

      const response = await POST(createMockRequest('POST', CREATE_BODY), params())

      expect(response.status).toBe(401)
      expect(mockCheckKnowledgeBaseWriteAccess).not.toHaveBeenCalled()
      expect(mockCreateTagDefinition).not.toHaveBeenCalled()
    })
  })
})

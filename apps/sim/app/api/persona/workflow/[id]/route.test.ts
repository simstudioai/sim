/**
 * Tests for persona/workflow/[id] API route
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockRequest, mockAuth, setupCommonApiMocks } from '@/app/api/__test-utils__/utils'

describe('Persona Workflow [id] API Route', () => {
  const { mockAuthenticatedUser } = mockAuth()
  const mockDelete = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    setupCommonApiMocks()
    mockDelete.mockReturnValue({ where: vi.fn().mockReturnValue(undefined) })
    vi.doMock('@/db', () => ({
      db: {
        delete: mockDelete,
      },
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('DELETE /api/persona/workflow/[id]', () => {
    it('should delete persona workflow by id', async () => {
      mockAuthenticatedUser()
      const req = createMockRequest('DELETE')
      const { DELETE } = await import('./route')
      const response = await DELETE(req, { params: { id: 'pw-1' } })
      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data).toHaveProperty('success', true)
    })
  })
})

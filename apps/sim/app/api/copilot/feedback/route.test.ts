/**
 * Tests for copilot feedback API route
 */
import { copilotHttpMock, copilotHttpMockFns, dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/mothership/request/http', () => copilotHttpMock)

import { GET } from '@/app/api/copilot/feedback/route'

describe('Copilot Feedback API Route', () => {
  beforeEach(() => {
    resetDbChainMock()
  })

  describe('GET', () => {
    it('should only return feedback records for the authenticated user', async () => {
      copilotHttpMockFns.mockAuthenticateCopilotRequestSessionOnly.mockResolvedValueOnce({
        userId: 'user-123',
        isAuthenticated: true,
      })

      const mockFeedback = [
        {
          feedbackId: 'feedback-1',
          userId: 'user-123',
          chatId: 'chat-1',
          userQuery: 'Query 1',
          agentResponse: 'Response 1',
          isPositive: true,
          feedback: null,
          workflowYaml: null,
          createdAt: new Date('2024-01-01'),
        },
      ]
      dbChainMockFns.where.mockResolvedValueOnce(mockFeedback)

      const request = new Request('http://localhost:3000/api/copilot/feedback')
      const response = await GET(request as any)

      expect(response.status).toBe(200)
      const responseData = await response.json()
      expect(responseData.success).toBe(true)
      expect(responseData.feedback).toHaveLength(1)
      expect(responseData.feedback[0].feedbackId).toBe('feedback-1')
      expect(responseData.feedback[0].userId).toBe('user-123')

      const { eq } = await import('drizzle-orm')
      expect(dbChainMockFns.where).toHaveBeenCalled()
      expect(eq).toHaveBeenCalledWith('copilotFeedback.userId', 'user-123')
    })
  })
})

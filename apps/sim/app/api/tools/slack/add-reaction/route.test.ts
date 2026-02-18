/**
 * Tests for Slack Add Reaction API route
 *
 * @vitest-environment node
 */
import {
  createMockFetch,
  createMockLogger,
  createMockRequest,
  createMockResponse,
} from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('Slack Add Reaction API Route', () => {
  const mockLogger = createMockLogger()
  const mockCheckInternalAuth = vi.fn()

  beforeEach(() => {
    vi.resetModules()

    vi.doMock('@sim/logger', () => ({
      createLogger: vi.fn().mockReturnValue(mockLogger),
    }))

    vi.doMock('@/lib/auth/hybrid', () => ({
      checkInternalAuth: mockCheckInternalAuth,
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it('should add reaction successfully', async () => {
    mockCheckInternalAuth.mockResolvedValueOnce({
      success: true,
      userId: 'user-123',
      authType: 'api-key',
    })

    const mockSlackResponse = createMockResponse({
      status: 200,
      json: { ok: true },
    })

    const mockFetch = vi.fn().mockResolvedValueOnce(mockSlackResponse)
    vi.stubGlobal('fetch', mockFetch)

    const req = createMockRequest(
      'POST',
      {
        accessToken: 'xoxb-test-token',
        channel: 'C1234567890',
        timestamp: '1405894322.002768',
        name: 'thumbsup',
      },
      {},
      'http://localhost:3000/api/tools/slack/add-reaction'
    )

    const { POST } = await import('@/app/api/tools/slack/add-reaction/route')
    const response = await POST(req as any)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.output.content).toBe('Successfully added :thumbsup: reaction')
    expect(data.output.metadata).toEqual({
      channel: 'C1234567890',
      timestamp: '1405894322.002768',
      reaction: 'thumbsup',
    })

    expect(mockFetch).toHaveBeenCalledWith(
      'https://slack.com/api/reactions.add',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: 'Bearer xoxb-test-token',
        }),
        body: JSON.stringify({
          channel: 'C1234567890',
          timestamp: '1405894322.002768',
          name: 'thumbsup',
        }),
      })
    )
  })

  it('should handle emoji name without colons', async () => {
    mockCheckInternalAuth.mockResolvedValueOnce({
      success: true,
      userId: 'user-123',
      authType: 'api-key',
    })

    const mockSlackResponse = createMockResponse({
      status: 200,
      json: { ok: true },
    })

    const mockFetch = vi.fn().mockResolvedValueOnce(mockSlackResponse)
    vi.stubGlobal('fetch', mockFetch)

    const req = createMockRequest(
      'POST',
      {
        accessToken: 'xoxb-test-token',
        channel: 'C1234567890',
        timestamp: '1405894322.002768',
        name: 'eyes',
      },
      {},
      'http://localhost:3000/api/tools/slack/add-reaction'
    )

    const { POST } = await import('@/app/api/tools/slack/add-reaction/route')
    const response = await POST(req as any)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.output.content).toBe('Successfully added :eyes: reaction')
  })

  it('should handle unauthenticated request', async () => {
    mockCheckInternalAuth.mockResolvedValueOnce({
      success: false,
      error: 'Authentication required',
    })

    const req = createMockRequest(
      'POST',
      {
        accessToken: 'xoxb-test-token',
        channel: 'C1234567890',
        timestamp: '1405894322.002768',
        name: 'thumbsup',
      },
      {},
      'http://localhost:3000/api/tools/slack/add-reaction'
    )

    const { POST } = await import('@/app/api/tools/slack/add-reaction/route')
    const response = await POST(req as any)
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.success).toBe(false)
    expect(data.error).toBe('Authentication required')
  })

  it('should handle missing access token', async () => {
    mockCheckInternalAuth.mockResolvedValueOnce({
      success: true,
      userId: 'user-123',
      authType: 'api-key',
    })

    const req = createMockRequest(
      'POST',
      {
        channel: 'C1234567890',
        timestamp: '1405894322.002768',
        name: 'thumbsup',
      },
      {},
      'http://localhost:3000/api/tools/slack/add-reaction'
    )

    const { POST } = await import('@/app/api/tools/slack/add-reaction/route')
    const response = await POST(req as any)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.success).toBe(false)
    expect(data.error).toBe('Invalid request data')
  })

  it('should handle missing channel', async () => {
    mockCheckInternalAuth.mockResolvedValueOnce({
      success: true,
      userId: 'user-123',
      authType: 'api-key',
    })

    const req = createMockRequest(
      'POST',
      {
        accessToken: 'xoxb-test-token',
        timestamp: '1405894322.002768',
        name: 'thumbsup',
      },
      {},
      'http://localhost:3000/api/tools/slack/add-reaction'
    )

    const { POST } = await import('@/app/api/tools/slack/add-reaction/route')
    const response = await POST(req as any)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.success).toBe(false)
    expect(data.error).toBe('Invalid request data')
  })

  it('should handle missing timestamp', async () => {
    mockCheckInternalAuth.mockResolvedValueOnce({
      success: true,
      userId: 'user-123',
      authType: 'api-key',
    })

    const req = createMockRequest(
      'POST',
      {
        accessToken: 'xoxb-test-token',
        channel: 'C1234567890',
        name: 'thumbsup',
      },
      {},
      'http://localhost:3000/api/tools/slack/add-reaction'
    )

    const { POST } = await import('@/app/api/tools/slack/add-reaction/route')
    const response = await POST(req as any)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.success).toBe(false)
    expect(data.error).toBe('Invalid request data')
  })

  it('should handle missing emoji name', async () => {
    mockCheckInternalAuth.mockResolvedValueOnce({
      success: true,
      userId: 'user-123',
      authType: 'api-key',
    })

    const req = createMockRequest(
      'POST',
      {
        accessToken: 'xoxb-test-token',
        channel: 'C1234567890',
        timestamp: '1405894322.002768',
      },
      {},
      'http://localhost:3000/api/tools/slack/add-reaction'
    )

    const { POST } = await import('@/app/api/tools/slack/add-reaction/route')
    const response = await POST(req as any)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.success).toBe(false)
    expect(data.error).toBe('Invalid request data')
  })

  it('should handle Slack API missing_scope error', async () => {
    mockCheckInternalAuth.mockResolvedValueOnce({
      success: true,
      userId: 'user-123',
      authType: 'api-key',
    })

    const mockSlackResponse = createMockResponse({
      status: 200,
      json: { ok: false, error: 'missing_scope' },
    })

    const mockFetch = vi.fn().mockResolvedValueOnce(mockSlackResponse)
    vi.stubGlobal('fetch', mockFetch)

    const req = createMockRequest(
      'POST',
      {
        accessToken: 'xoxb-test-token',
        channel: 'C1234567890',
        timestamp: '1405894322.002768',
        name: 'thumbsup',
      },
      {},
      'http://localhost:3000/api/tools/slack/add-reaction'
    )

    const { POST } = await import('@/app/api/tools/slack/add-reaction/route')
    const response = await POST(req as any)
    const data = await response.json()

    expect(data.success).toBe(false)
    expect(data.error).toBe('missing_scope')
  })

  it('should handle Slack API channel_not_found error', async () => {
    mockCheckInternalAuth.mockResolvedValueOnce({
      success: true,
      userId: 'user-123',
      authType: 'api-key',
    })

    const mockSlackResponse = createMockResponse({
      status: 200,
      json: { ok: false, error: 'channel_not_found' },
    })

    const mockFetch = vi.fn().mockResolvedValueOnce(mockSlackResponse)
    vi.stubGlobal('fetch', mockFetch)

    const req = createMockRequest(
      'POST',
      {
        accessToken: 'xoxb-test-token',
        channel: 'CINVALID',
        timestamp: '1405894322.002768',
        name: 'thumbsup',
      },
      {},
      'http://localhost:3000/api/tools/slack/add-reaction'
    )

    const { POST } = await import('@/app/api/tools/slack/add-reaction/route')
    const response = await POST(req as any)
    const data = await response.json()

    expect(data.success).toBe(false)
    expect(data.error).toBe('channel_not_found')
  })

  it('should handle Slack API message_not_found error', async () => {
    mockCheckInternalAuth.mockResolvedValueOnce({
      success: true,
      userId: 'user-123',
      authType: 'api-key',
    })

    const mockSlackResponse = createMockResponse({
      status: 200,
      json: { ok: false, error: 'message_not_found' },
    })

    const mockFetch = vi.fn().mockResolvedValueOnce(mockSlackResponse)
    vi.stubGlobal('fetch', mockFetch)

    const req = createMockRequest(
      'POST',
      {
        accessToken: 'xoxb-test-token',
        channel: 'C1234567890',
        timestamp: '0000000000.000000',
        name: 'thumbsup',
      },
      {},
      'http://localhost:3000/api/tools/slack/add-reaction'
    )

    const { POST } = await import('@/app/api/tools/slack/add-reaction/route')
    const response = await POST(req as any)
    const data = await response.json()

    expect(data.success).toBe(false)
    expect(data.error).toBe('message_not_found')
  })

  it('should handle Slack API invalid_name error for invalid emoji', async () => {
    mockCheckInternalAuth.mockResolvedValueOnce({
      success: true,
      userId: 'user-123',
      authType: 'api-key',
    })

    const mockSlackResponse = createMockResponse({
      status: 200,
      json: { ok: false, error: 'invalid_name' },
    })

    const mockFetch = vi.fn().mockResolvedValueOnce(mockSlackResponse)
    vi.stubGlobal('fetch', mockFetch)

    const req = createMockRequest(
      'POST',
      {
        accessToken: 'xoxb-test-token',
        channel: 'C1234567890',
        timestamp: '1405894322.002768',
        name: 'not_a_valid_emoji',
      },
      {},
      'http://localhost:3000/api/tools/slack/add-reaction'
    )

    const { POST } = await import('@/app/api/tools/slack/add-reaction/route')
    const response = await POST(req as any)
    const data = await response.json()

    expect(data.success).toBe(false)
    expect(data.error).toBe('invalid_name')
  })

  it('should handle Slack API already_reacted error', async () => {
    mockCheckInternalAuth.mockResolvedValueOnce({
      success: true,
      userId: 'user-123',
      authType: 'api-key',
    })

    const mockSlackResponse = createMockResponse({
      status: 200,
      json: { ok: false, error: 'already_reacted' },
    })

    const mockFetch = vi.fn().mockResolvedValueOnce(mockSlackResponse)
    vi.stubGlobal('fetch', mockFetch)

    const req = createMockRequest(
      'POST',
      {
        accessToken: 'xoxb-test-token',
        channel: 'C1234567890',
        timestamp: '1405894322.002768',
        name: 'thumbsup',
      },
      {},
      'http://localhost:3000/api/tools/slack/add-reaction'
    )

    const { POST } = await import('@/app/api/tools/slack/add-reaction/route')
    const response = await POST(req as any)
    const data = await response.json()

    expect(data.success).toBe(false)
    expect(data.error).toBe('already_reacted')
  })

  it('should handle network error when calling Slack API', async () => {
    mockCheckInternalAuth.mockResolvedValueOnce({
      success: true,
      userId: 'user-123',
      authType: 'api-key',
    })

    const mockFetch = vi.fn().mockRejectedValueOnce(new Error('Network error'))
    vi.stubGlobal('fetch', mockFetch)

    const req = createMockRequest(
      'POST',
      {
        accessToken: 'xoxb-test-token',
        channel: 'C1234567890',
        timestamp: '1405894322.002768',
        name: 'thumbsup',
      },
      {},
      'http://localhost:3000/api/tools/slack/add-reaction'
    )

    const { POST } = await import('@/app/api/tools/slack/add-reaction/route')
    const response = await POST(req as any)
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.success).toBe(false)
    expect(data.error).toBe('Network error')
  })

  it('should handle various emoji names correctly', async () => {
    const emojiNames = ['heart', 'fire', 'rocket', '+1', '-1', 'tada', 'eyes', 'thinking_face']

    for (const emojiName of emojiNames) {
      vi.resetModules()

      vi.doMock('@sim/logger', () => ({
        createLogger: vi.fn().mockReturnValue(mockLogger),
      }))

      vi.doMock('@/lib/auth/hybrid', () => ({
        checkInternalAuth: mockCheckInternalAuth,
      }))

      mockCheckInternalAuth.mockResolvedValueOnce({
        success: true,
        userId: 'user-123',
        authType: 'api-key',
      })

      const mockSlackResponse = createMockResponse({
        status: 200,
        json: { ok: true },
      })

      const mockFetch = vi.fn().mockResolvedValueOnce(mockSlackResponse)
      vi.stubGlobal('fetch', mockFetch)

      const req = createMockRequest(
        'POST',
        {
          accessToken: 'xoxb-test-token',
          channel: 'C1234567890',
          timestamp: '1405894322.002768',
          name: emojiName,
        },
        {},
        'http://localhost:3000/api/tools/slack/add-reaction'
      )

      const { POST } = await import('@/app/api/tools/slack/add-reaction/route')
      const response = await POST(req as any)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.output.metadata.reaction).toBe(emojiName)
    }
  })
})

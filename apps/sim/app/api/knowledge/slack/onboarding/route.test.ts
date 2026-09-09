/** @vitest-environment node */
import { authMockFns, createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ read: vi.fn(), retry: vi.fn() }))
vi.mock('@/lib/knowledge/application/slack-search/onboarding', () => {
  const read = {
    id: 'knowledge.slack.onboarding.read',
    capability: 'none',
    principalKinds: ['session'],
  }
  const retry = {
    id: 'knowledge.slack.onboarding.retry',
    capability: 'knowledge.use',
    principalKinds: ['session'],
  }
  return {
    slackSearchOnboardingOperations: { read, retry },
    getSlackSearchOnboarding: { operation: read, execute: mocks.read },
    retrySlackSearchOnboarding: { operation: retry, execute: mocks.retry },
  }
})

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { POST } from '@/app/api/knowledge/slack/onboarding/retry/route'
import { GET } from '@/app/api/knowledge/slack/onboarding/route'

const token = 'bf1ff774-505b-4f2f-946d-9c54ed75de47'
const url = `http://localhost/api/knowledge/slack/onboarding?token=${token}`

beforeEach(() => {
  vi.clearAllMocks()
  authMockFns.mockGetSession.mockResolvedValue({
    user: { id: 'sender' },
    session: { id: 'session' },
  })
  mocks.read.mockResolvedValue({ status: 'membership_required' })
  mocks.retry.mockResolvedValue({ slackUrl: 'https://example.slack.com/archives/D1/p1' })
})

describe('Slack onboarding routes', () => {
  it('authenticates both routes before parsing invalid input', async () => {
    authMockFns.mockGetSession.mockResolvedValue(null)
    expect((await GET(createMockRequest('GET'))).status).toBe(401)
    expect((await POST(createMockRequest('POST', {}))).status).toBe(401)
    expect(mocks.read).not.toHaveBeenCalled()
    expect(mocks.retry).not.toHaveBeenCalled()
  })

  it('rejects malformed tokens before entering the application', async () => {
    expect((await GET(createMockRequest('GET'))).status).toBe(400)
    expect((await POST(createMockRequest('POST', { token: 'invalid' }))).status).toBe(400)
    expect(mocks.read).not.toHaveBeenCalled()
    expect(mocks.retry).not.toHaveBeenCalled()
  })

  it('projects only the blocked view and keeps the response private', async () => {
    mocks.read.mockResolvedValue({
      status: 'membership_required',
      question: 'private question',
      organizationId: 'private organization',
      email: 'private@example.test',
    })
    const response = await GET(createMockRequest('GET', undefined, {}, url))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'membership_required' })
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer')
    expect(mocks.read).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: { kind: 'session', userId: 'sender', sessionId: 'session' },
        input: { token },
      })
    )
    expect(mocks.retry).not.toHaveBeenCalled()
  })

  it('passes explicit retries to the same signed-in principal', async () => {
    const response = await POST(createMockRequest('POST', { token }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      slackUrl: 'https://example.slack.com/archives/D1/p1',
    })
    expect(mocks.retry).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: { kind: 'session', userId: 'sender', sessionId: 'session' },
        input: { token },
      })
    )
  })

  it('preserves authorization denial without returning a question', async () => {
    mocks.retry.mockRejectedValue(new OrchestrationError('forbidden', 'Complete account setup'))
    const response = await POST(createMockRequest('POST', { token }))
    expect(response.status).toBe(403)
    expect(await response.json()).not.toHaveProperty('slackUrl')
  })

  it('conceals unexpected infrastructure errors', async () => {
    mocks.read.mockRejectedValue(new Error('private database connection'))
    const response = await GET(createMockRequest('GET', undefined, {}, url))
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ error: 'Internal server error' })
  })
})

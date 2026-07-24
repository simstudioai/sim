/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPollApproval, mockGenerateCopilotApiKey, mockEnforceIpRateLimit } = vi.hoisted(() => ({
  mockPollApproval: vi.fn(),
  mockGenerateCopilotApiKey: vi.fn(),
  mockEnforceIpRateLimit: vi.fn(),
}))

vi.mock('@/lib/cli-auth/approval-store', () => ({
  pollApproval: mockPollApproval,
}))

vi.mock('@/lib/copilot/server/api-keys', () => ({
  generateCopilotApiKey: mockGenerateCopilotApiKey,
  CopilotApiKeyError: class extends Error {},
}))

vi.mock('@/lib/core/rate-limiter', () => ({
  enforceIpRateLimit: mockEnforceIpRateLimit,
}))

import { POST } from '@/app/api/cli/auth/poll/route'

const REQUEST = 'a'.repeat(43)
const VERIFIER = 'b'.repeat(43)

function pollRequest(body: Record<string, unknown>) {
  return createMockRequest('POST', body)
}

describe('POST /api/cli/auth/poll', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnforceIpRateLimit.mockResolvedValue(null)
    mockGenerateCopilotApiKey.mockResolvedValue({ id: 'key-1', apiKey: 'sk-test' })
  })

  it('returns pending without minting while unapproved', async () => {
    mockPollApproval.mockResolvedValue({ status: 'pending' })
    const response = await POST(pollRequest({ request: REQUEST, verifier: VERIFIER }))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: 'pending' })
    expect(mockGenerateCopilotApiKey).not.toHaveBeenCalled()
  })

  it('mints for the approving user once approved', async () => {
    mockPollApproval.mockResolvedValue({ status: 'approved', userId: 'user-1' })
    const response = await POST(pollRequest({ request: REQUEST, verifier: VERIFIER }))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      status: 'complete',
      key: { id: 'key-1', apiKey: 'sk-test' },
    })
    expect(mockGenerateCopilotApiKey).toHaveBeenCalledWith('user-1', expect.stringMatching(/^CLI /))
  })

  it('rejects a malformed verifier before touching the store', async () => {
    const response = await POST(pollRequest({ request: REQUEST, verifier: 'too-short' }))
    expect(response.status).toBe(400)
    expect(mockPollApproval).not.toHaveBeenCalled()
  })

  it('honors the IP rate limiter', async () => {
    mockEnforceIpRateLimit.mockResolvedValue(
      new Response(null, { status: 429 }) as unknown as never
    )
    const response = await POST(pollRequest({ request: REQUEST, verifier: VERIFIER }))
    expect(response.status).toBe(429)
    expect(mockPollApproval).not.toHaveBeenCalled()
  })
})

/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockConsumeAuthCode, mockGenerateCopilotApiKey, mockEnforceIpRateLimit } = vi.hoisted(
  () => ({
    mockConsumeAuthCode: vi.fn(),
    mockGenerateCopilotApiKey: vi.fn(),
    mockEnforceIpRateLimit: vi.fn(),
  })
)

vi.mock('@/lib/cli-auth/code-store', () => ({
  consumeAuthCode: mockConsumeAuthCode,
}))

vi.mock('@/lib/copilot/server/generate-api-key', () => ({
  generateCopilotApiKey: mockGenerateCopilotApiKey,
  CopilotApiKeyError: class extends Error {},
}))

vi.mock('@/lib/core/rate-limiter', () => ({
  enforceIpRateLimit: mockEnforceIpRateLimit,
}))

import { POST } from '@/app/api/cli/auth/token/route'

const VERIFIER = 'a'.repeat(43)

function tokenRequest(body: Record<string, unknown>) {
  return createMockRequest('POST', body)
}

describe('POST /api/cli/auth/token', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnforceIpRateLimit.mockResolvedValue(null)
    mockGenerateCopilotApiKey.mockResolvedValue({ id: 'key-1', apiKey: 'sk-test' })
  })

  it('exchanges a valid code for a key', async () => {
    mockConsumeAuthCode.mockResolvedValue('user-1')

    const response = await POST(tokenRequest({ code: 'good-code', verifier: VERIFIER }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ key: { id: 'key-1', apiKey: 'sk-test' } })
    expect(mockGenerateCopilotApiKey).toHaveBeenCalledWith('user-1', expect.stringMatching(/^CLI /))
  })

  it('never mints when the code is rejected', async () => {
    mockConsumeAuthCode.mockResolvedValue(null)

    const response = await POST(tokenRequest({ code: 'bad-code', verifier: VERIFIER }))

    expect(response.status).toBe(400)
    expect(mockGenerateCopilotApiKey).not.toHaveBeenCalled()
  })

  it('returns an identical response for unknown and mismatched codes', async () => {
    mockConsumeAuthCode.mockResolvedValueOnce(null)
    const unknown = await POST(tokenRequest({ code: 'unknown', verifier: VERIFIER }))

    mockConsumeAuthCode.mockResolvedValueOnce(null)
    const mismatched = await POST(tokenRequest({ code: 'known', verifier: 'b'.repeat(43) }))

    expect(unknown.status).toBe(mismatched.status)
    await expect(unknown.json()).resolves.toEqual(await mismatched.json())
  })

  it('rejects a malformed verifier before touching the store', async () => {
    const response = await POST(tokenRequest({ code: 'good-code', verifier: 'too-short' }))

    expect(response.status).toBe(400)
    expect(mockConsumeAuthCode).not.toHaveBeenCalled()
  })

  it('honors the IP rate limiter', async () => {
    mockEnforceIpRateLimit.mockResolvedValue(
      new Response(null, { status: 429 }) as unknown as never
    )

    const response = await POST(tokenRequest({ code: 'good-code', verifier: VERIFIER }))

    expect(response.status).toBe(429)
    expect(mockConsumeAuthCode).not.toHaveBeenCalled()
  })
})

/**
 * @vitest-environment node
 */
import {
  createMockRequest,
  queueTableRows,
  resetDbChainMock,
  resetEnvMock,
  schemaMock,
  setEnv,
} from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockRecordUsage,
  mockCheckActorUsageLimits,
  mockResolveSystemBillingAttribution,
  mockCheckAttributedUsageLimits,
  mockToBillingContext,
  mockCheckAndBillPayerOverageThreshold,
  mockCheckRateLimitDirect,
} = vi.hoisted(() => ({
  mockRecordUsage: vi.fn(),
  mockCheckActorUsageLimits: vi.fn(),
  mockResolveSystemBillingAttribution: vi.fn(),
  mockCheckAttributedUsageLimits: vi.fn(),
  mockToBillingContext: vi.fn(),
  mockCheckAndBillPayerOverageThreshold: vi.fn(),
  mockCheckRateLimitDirect: vi.fn(),
}))

const SYSTEM_BILLING_ATTRIBUTION = {
  actorUserId: 'payer-1',
  workspaceId: 'ws-1',
  organizationId: 'org-1',
  billedAccountUserId: 'payer-1',
  billingEntity: { type: 'organization' as const, id: 'org-1' },
  billingPeriod: {
    start: '2026-07-01T00:00:00.000Z',
    end: '2026-08-01T00:00:00.000Z',
  },
  payerSubscription: null,
}

vi.mock('@/lib/billing/core/usage-log', () => ({ recordUsage: mockRecordUsage }))

vi.mock('@/lib/billing/core/billing-attribution', () => ({
  resolveSystemBillingAttribution: mockResolveSystemBillingAttribution,
  checkAttributedUsageLimits: mockCheckAttributedUsageLimits,
  toBillingContext: mockToBillingContext,
}))

vi.mock('@/lib/billing/calculations/usage-monitor', () => ({
  checkActorUsageLimits: mockCheckActorUsageLimits,
}))

vi.mock('@/lib/billing/threshold-billing', () => ({
  checkAndBillPayerOverageThreshold: mockCheckAndBillPayerOverageThreshold,
}))

vi.mock('@/lib/core/rate-limiter', () => ({
  RateLimiter: class {
    checkRateLimitDirect = mockCheckRateLimitDirect
  },
}))

vi.mock('@/lib/core/security/deployment', () => ({ validateAuthToken: vi.fn(() => false) }))

import { DEFAULT_TTS_VOICE_ID, MAX_TTS_TEXT_LENGTH } from '@/lib/api/contracts/media/tts-stream'
import { POST } from '@/app/api/proxy/tts/stream/route'

const publicChatRow = {
  id: 'chat-1',
  userId: 'owner-1',
  isActive: true,
  authType: 'public',
  password: null,
  workspaceId: 'ws-1',
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    text: 'Hello from the deployed chat.',
    voiceId: DEFAULT_TTS_VOICE_ID,
    chatId: 'chat-1',
    ...overrides,
  }
}

/** Minimal ElevenLabs stub returning a readable audio body. */
function mockElevenLabsAudio() {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([0x49, 0x44, 0x33]))
        controller.close()
      },
    }),
    // double-cast-allowed: minimal fetch stub for the ElevenLabs stream call
  }) as unknown as typeof fetch
}

beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
  setEnv({ ELEVENLABS_API_KEY: 'test-key' })
  mockCheckRateLimitDirect.mockResolvedValue({ allowed: true, remaining: 10 })
  mockRecordUsage.mockResolvedValue(undefined)
  mockCheckActorUsageLimits.mockResolvedValue({ isExceeded: false })
  mockCheckAttributedUsageLimits.mockResolvedValue({ isExceeded: false })
  mockResolveSystemBillingAttribution.mockResolvedValue(SYSTEM_BILLING_ATTRIBUTION)
  mockToBillingContext.mockImplementation(
    (attribution: { billingEntity: { type: 'organization' | 'user'; id: string } }) => ({
      billingEntity: attribution.billingEntity,
      billingPeriod: {
        start: new Date('2026-07-01T00:00:00.000Z'),
        end: new Date('2026-08-01T00:00:00.000Z'),
      },
    })
  )
  mockElevenLabsAudio()
})

afterAll(() => {
  resetDbChainMock()
  resetEnvMock()
})

describe('POST /api/proxy/tts/stream — spend controls', () => {
  it('caps text length so one request cannot bill unbounded characters', async () => {
    const res = await POST(
      createMockRequest('POST', validBody({ text: 'a'.repeat(MAX_TTS_TEXT_LENGTH + 1) }))
    )

    expect(res.status).toBe(400)
    expect(global.fetch).not.toHaveBeenCalled()
    expect(mockRecordUsage).not.toHaveBeenCalled()
  })

  it('rejects an oversized body before buffering it', async () => {
    const res = await POST(createMockRequest('POST', validBody({ padding: 'x'.repeat(32 * 1024) })))

    expect(res.status).toBe(413)
    expect(global.fetch).not.toHaveBeenCalled()
    expect(mockRecordUsage).not.toHaveBeenCalled()
  })

  it('rejects a voice outside the allowlist so the caller cannot pick a premium voice', async () => {
    const res = await POST(
      createMockRequest('POST', validBody({ voiceId: '21m00Tcm4TlvDq8ikWAM' }))
    )

    expect(res.status).toBe(400)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('rejects a model outside the allowlist so the caller cannot pick the billing model', async () => {
    const res = await POST(
      createMockRequest('POST', validBody({ modelId: 'eleven_multilingual_v2' }))
    )

    expect(res.status).toBe(400)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('throttles per IP before any chat lookup so a flood cannot be amplified into queries', async () => {
    mockCheckRateLimitDirect.mockResolvedValueOnce({ allowed: false, retryAfterMs: 30_000 })

    const res = await POST(createMockRequest('POST', validBody()))

    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('30')
    expect(mockCheckRateLimitDirect.mock.calls[0][0]).toContain('tts-stream:ip:')
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('throttles per chat so many callers cannot drain one public chat', async () => {
    queueTableRows(schemaMock.chat, [publicChatRow])
    mockCheckRateLimitDirect
      .mockResolvedValueOnce({ allowed: true, remaining: 10 })
      .mockResolvedValueOnce({ allowed: false, retryAfterMs: 60_000 })

    const res = await POST(createMockRequest('POST', validBody()))

    expect(res.status).toBe(429)
    expect(mockCheckRateLimitDirect.mock.calls[1][0]).toBe('tts-stream:chat:chat-1')
    expect(global.fetch).not.toHaveBeenCalled()
    expect(mockRecordUsage).not.toHaveBeenCalled()
  })
})

describe('POST /api/proxy/tts/stream — attribution', () => {
  it('meters synthesized characters against the chat workspace payer', async () => {
    queueTableRows(schemaMock.chat, [publicChatRow])
    const text = 'a'.repeat(1000)

    const res = await POST(createMockRequest('POST', validBody({ text })))

    expect(res.status).toBe(200)
    expect(mockResolveSystemBillingAttribution).toHaveBeenCalledWith('ws-1')
    expect(mockCheckAttributedUsageLimits).toHaveBeenCalledWith(SYSTEM_BILLING_ATTRIBUTION)
    expect(mockRecordUsage).toHaveBeenCalledTimes(1)
    expect(mockRecordUsage.mock.calls[0][0]).toMatchObject({
      userId: 'payer-1',
      workspaceId: 'ws-1',
      billingEntity: { type: 'organization', id: 'org-1' },
    })
    expect(mockRecordUsage.mock.calls[0][0].entries[0]).toMatchObject({
      category: 'fixed',
      source: 'voice-output',
      cost: 0.05,
    })
  })

  it('gives each call a unique source reference so equal-length calls are not deduplicated', async () => {
    const text = 'Same length text.'

    queueTableRows(schemaMock.chat, [publicChatRow])
    await POST(createMockRequest('POST', validBody({ text })))
    queueTableRows(schemaMock.chat, [publicChatRow])
    await POST(createMockRequest('POST', validBody({ text })))

    expect(mockRecordUsage).toHaveBeenCalledTimes(2)
    const first = mockRecordUsage.mock.calls[0][0].entries[0].sourceReference
    const second = mockRecordUsage.mock.calls[1][0].entries[0].sourceReference
    expect(first).toBeDefined()
    expect(first).not.toBe(second)
  })

  it('does not run per-request threshold settlement on the realtime path', async () => {
    queueTableRows(schemaMock.chat, [publicChatRow])

    await POST(createMockRequest('POST', validBody()))

    expect(mockCheckAndBillPayerOverageThreshold).not.toHaveBeenCalled()
  })

  it('falls back to the chat owner when the workflow has no workspace', async () => {
    queueTableRows(schemaMock.chat, [{ ...publicChatRow, workspaceId: null }])

    const res = await POST(createMockRequest('POST', validBody()))

    expect(res.status).toBe(200)
    expect(mockResolveSystemBillingAttribution).not.toHaveBeenCalled()
    expect(mockCheckActorUsageLimits).toHaveBeenCalledWith('owner-1')
    expect(mockRecordUsage.mock.calls[0][0]).toMatchObject({ userId: 'owner-1' })
  })

  it('refuses to spend when the payer is over its usage limit', async () => {
    queueTableRows(schemaMock.chat, [publicChatRow])
    mockCheckAttributedUsageLimits.mockResolvedValue({
      isExceeded: true,
      message: 'Usage limit exceeded.',
    })

    const res = await POST(createMockRequest('POST', validBody()))

    expect(res.status).toBe(402)
    expect(global.fetch).not.toHaveBeenCalled()
    expect(mockRecordUsage).not.toHaveBeenCalled()
  })

  it('rejects an unknown chat without touching the platform key', async () => {
    queueTableRows(schemaMock.chat, [])

    const res = await POST(createMockRequest('POST', validBody()))

    expect(res.status).toBe(401)
    expect(global.fetch).not.toHaveBeenCalled()
    expect(mockRecordUsage).not.toHaveBeenCalled()
  })

  it('does not expose the audio stream to arbitrary origins', async () => {
    queueTableRows(schemaMock.chat, [publicChatRow])

    const res = await POST(createMockRequest('POST', validBody()))

    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })
})

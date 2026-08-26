/**
 * @vitest-environment node
 */

import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  MockV2ApiKeyUnauthenticatedError,
  MockWorkspaceAccessDeniedError,
  billingAttributionSnapshot,
  mockAssertActiveWorkspaceAccess,
  mockAuthenticateV2ApiKey,
  mockCheckOperationRate,
  mockCheckPreAuthRate,
  mockGenerateId,
  mockRequestExplicitStreamAbort,
  mockResolveBillingAttribution,
  mockResolveOrCreateChat,
  mockRunHeadlessCopilotLifecycle,
} = vi.hoisted(() => ({
  MockV2ApiKeyUnauthenticatedError: class MockV2ApiKeyUnauthenticatedError extends Error {},
  MockWorkspaceAccessDeniedError: class MockWorkspaceAccessDeniedError extends Error {},
  mockAssertActiveWorkspaceAccess: vi.fn(),
  mockAuthenticateV2ApiKey: vi.fn(),
  billingAttributionSnapshot: {
    actorUserId: 'user-1',
    workspaceId: 'workspace-1',
    organizationId: null,
    billedAccountUserId: 'user-1',
    billingEntity: { type: 'user', id: 'user-1' },
    billingPeriod: { start: '2026-08-01T00:00:00.000Z', end: '2026-09-01T00:00:00.000Z' },
    payerSubscription: null,
  },
  mockCheckOperationRate: vi.fn(),
  mockCheckPreAuthRate: vi.fn(),
  mockGenerateId: vi.fn(),
  mockResolveBillingAttribution: vi.fn(),
  mockResolveOrCreateChat: vi.fn(),
  mockRequestExplicitStreamAbort: vi.fn().mockResolvedValue(undefined),
  mockRunHeadlessCopilotLifecycle: vi.fn(),
}))

vi.mock('@/lib/api/server/routes/v2-api-key-auth', () => ({
  authenticateV2ApiKey: mockAuthenticateV2ApiKey,
  V2ApiKeyUnauthenticatedError: MockV2ApiKeyUnauthenticatedError,
}))

vi.mock('@/lib/core/rate-limiter', () => ({
  getRateLimit: () => ({ maxTokens: 100, refillRate: 50, refillIntervalMs: 60_000 }),
  RateLimiter: class RateLimiter {
    checkRateLimitDirect = mockCheckPreAuthRate
    checkRateLimitDirectOrThrow = mockCheckOperationRate
  },
}))

vi.mock('@sim/utils/id', () => ({
  generateId: mockGenerateId,
  generateShortId: vi.fn(() => 'mock-short-id'),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  assertActiveWorkspaceAccess: mockAssertActiveWorkspaceAccess,
  isWorkspaceAccessDeniedError: (error: unknown) => error instanceof MockWorkspaceAccessDeniedError,
}))

vi.mock('@/lib/billing/core/billing-attribution', () => ({
  resolveBillingAttribution: mockResolveBillingAttribution,
}))

vi.mock('@/lib/environment/utils', () => ({
  getPersonalAndWorkspaceEnv: vi.fn().mockResolvedValue({ personal: {}, workspace: {} }),
}))

vi.mock('@/lib/copilot/environment-context', () => ({
  createCopilotEnvironmentContext: vi.fn().mockResolvedValue({ id: 'env-context' }),
}))

vi.mock('@/lib/copilot/chat/workspace-context', () => ({
  generateWorkspaceContext: vi.fn().mockResolvedValue('workspace context'),
}))

vi.mock('@/lib/copilot/chat/lifecycle', () => ({
  resolveOrCreateChat: mockResolveOrCreateChat,
}))

vi.mock('@/lib/copilot/chat/payload', () => ({
  buildIntegrationToolSchemas: vi.fn().mockResolvedValue([{ name: 'run_workflow' }]),
}))

vi.mock('@/lib/copilot/entitlements', () => ({
  computeWorkspaceEntitlements: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/copilot/request/lifecycle/headless', () => ({
  runHeadlessCopilotLifecycle: mockRunHeadlessCopilotLifecycle,
}))

vi.mock('@/lib/copilot/request/session/explicit-abort', () => ({
  requestExplicitStreamAbort: mockRequestExplicitStreamAbort,
}))

vi.mock('@/lib/copilot/secret-mount-policy', () => ({
  normalizeSecretMountPolicy: vi.fn(() => ({ secretScope: 'all', mountedSecrets: [] })),
}))

vi.mock('@/lib/core/config/env-flags', () => ({
  isDocSandboxEnabled: false,
}))

import { POST } from '@/app/api/v2/chat/route'

const personalAuth = {
  principal: { kind: 'personal_api_key', userId: 'user-1', keyId: 'key-1' },
  rateLimitSubjectIds: ['api-key:key-1', 'user:user-1'],
  rateLimitSubscription: null,
  keyType: 'personal',
}

/**
 * The route never echoes the caller's string back as the conversation id: it
 * reports whatever the owner-scoped resolver returns.
 */
const SERVER_ISSUED_CHAT_ID = 'chat-server-1'
const OWNED_CONVERSATION_ID = '11111111-1111-4111-8111-111111111111'

function chatRow(id: string) {
  return { id, userId: 'user-1', workspaceId: 'workspace-1', workflowId: null, type: 'mothership' }
}

const successResult = {
  success: true,
  content: 'Hello there',
  toolCalls: [{ name: 'run_workflow' }, { name: 'internal_only' }],
  usage: { prompt: 10, completion: 5 },
  cost: { total: 0.01 },
}

function callChat(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  const req = createMockRequest('POST', body, { 'X-API-Key': 'test-key', ...headers })
  return POST(req, { params: Promise.resolve({}) })
}

async function readNdjsonEvents(response: Response): Promise<Array<Record<string, unknown>>> {
  const raw = await response.text()
  return raw
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line))
}

describe('POST /api/v2/chat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    let generated = 0
    mockGenerateId.mockImplementation(() => `generated-${++generated}`)
    mockAuthenticateV2ApiKey.mockResolvedValue(personalAuth)
    mockCheckPreAuthRate.mockResolvedValue({ allowed: true, remaining: 10, resetAt: new Date() })
    mockCheckOperationRate.mockResolvedValue({ allowed: true, remaining: 10, resetAt: new Date() })
    mockAssertActiveWorkspaceAccess.mockResolvedValue({ permission: 'admin' })
    mockResolveBillingAttribution.mockResolvedValue(billingAttributionSnapshot)
    mockRequestExplicitStreamAbort.mockResolvedValue(undefined)
    mockRunHeadlessCopilotLifecycle.mockResolvedValue(successResult)
    mockResolveOrCreateChat.mockResolvedValue({
      chatId: SERVER_ISSUED_CHAT_ID,
      chat: chatRow(SERVER_ISSUED_CHAT_ID),
      conversationHistory: [],
      isNew: true,
    })
  })

  it('rejects a missing or invalid API key', async () => {
    mockAuthenticateV2ApiKey.mockRejectedValue(
      new MockV2ApiKeyUnauthenticatedError('API key required')
    )

    const response = await callChat({ workspaceId: 'workspace-1', message: 'hi' })

    expect(response.status).toBe(401)
  })

  it('rejects a workspace API key: chat has no acting user to attribute', async () => {
    mockAuthenticateV2ApiKey.mockResolvedValue({
      ...personalAuth,
      principal: { kind: 'workspace_api_key', workspaceId: 'workspace-1', keyId: 'key-2' },
      keyType: 'workspace',
    })

    const response = await callChat({ workspaceId: 'workspace-1', message: 'hi' })

    expect(response.status).toBe(403)
    const body = await response.json()
    expect(body.error.details.code).toBe('PRINCIPAL_KIND_NOT_PERMITTED')
    expect(mockRunHeadlessCopilotLifecycle).not.toHaveBeenCalled()
  })

  it('rejects an empty message before running anything', async () => {
    const response = await callChat({ workspaceId: 'workspace-1', message: '' })

    expect(response.status).toBe(400)
    expect(mockRunHeadlessCopilotLifecycle).not.toHaveBeenCalled()
  })

  it('answers 403 when the caller cannot access the workspace', async () => {
    mockAssertActiveWorkspaceAccess.mockRejectedValue(new MockWorkspaceAccessDeniedError('denied'))

    const response = await callChat({ workspaceId: 'workspace-1', message: 'hi' })

    expect(response.status).toBe(403)
    expect(mockRunHeadlessCopilotLifecycle).not.toHaveBeenCalled()
  })

  it('runs one turn and answers the reply with a server-issued conversation id', async () => {
    const response = await callChat({ workspaceId: 'workspace-1', message: 'hi' })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data).toEqual({
      content: 'Hello there',
      model: 'sim',
      conversationId: SERVER_ISSUED_CHAT_ID,
      tokens: { prompt: 10, completion: 5, total: 15 },
      cost: { total: 0.01 },
      toolCalls: [{ name: 'run_workflow' }],
    })

    const [payload, options] = mockRunHeadlessCopilotLifecycle.mock.calls[0]
    expect(payload).toMatchObject({
      messages: [{ role: 'user', content: 'hi' }],
      userId: 'user-1',
      workspaceId: 'workspace-1',
      chatId: SERVER_ISSUED_CHAT_ID,
      mode: 'agent',
      isHosted: true,
      workspaceContext: 'workspace context',
      integrationTools: [{ name: 'run_workflow' }],
      userPermission: 'admin',
    })
    expect(options).toMatchObject({
      userId: 'user-1',
      workspaceId: 'workspace-1',
      chatId: SERVER_ISSUED_CHAT_ID,
      goRoute: '/api/mothership/execute',
      autoExecuteTools: true,
      interactive: false,
      // Hosted execution refuses to run without attribution, so the resolved
      // snapshot must always ride along.
      billingAttribution: billingAttributionSnapshot,
    })
    expect(mockResolveBillingAttribution).toHaveBeenCalledWith({
      actorUserId: 'user-1',
      workspaceId: 'workspace-1',
    })
  })

  it('mints a server-issued conversation when the caller names none', async () => {
    const response = await callChat({ workspaceId: 'workspace-1', message: 'hi' })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data.conversationId).toBe(SERVER_ISSUED_CHAT_ID)
    const resolverInput = mockResolveOrCreateChat.mock.calls[0][0] as Record<string, unknown>
    expect(Object.hasOwn(resolverInput, 'chatId')).toBe(false)
    expect(resolverInput).toMatchObject({
      userId: 'user-1',
      workspaceId: 'workspace-1',
      type: 'mothership',
    })
  })

  it('resolves a named conversation against the calling user and workspace before continuing it', async () => {
    mockResolveOrCreateChat.mockResolvedValue({
      chatId: OWNED_CONVERSATION_ID,
      chat: chatRow(OWNED_CONVERSATION_ID),
      conversationHistory: [],
      isNew: false,
    })

    const response = await callChat({
      workspaceId: 'workspace-1',
      message: 'and then?',
      conversationId: OWNED_CONVERSATION_ID,
    })

    expect(response.status).toBe(200)
    expect(mockResolveOrCreateChat).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: OWNED_CONVERSATION_ID,
        userId: 'user-1',
        workspaceId: 'workspace-1',
      })
    )
    const body = await response.json()
    expect(body.data.conversationId).toBe(OWNED_CONVERSATION_ID)
    expect(mockRunHeadlessCopilotLifecycle.mock.calls[0][0]).toMatchObject({
      chatId: OWNED_CONVERSATION_ID,
    })
  })

  it('answers 404 and runs nothing when the resolver refuses the named conversation', async () => {
    mockResolveOrCreateChat.mockResolvedValue({
      chatId: OWNED_CONVERSATION_ID,
      chat: null,
      conversationHistory: [],
      isNew: false,
    })

    const response = await callChat({
      workspaceId: 'workspace-1',
      message: 'and then?',
      conversationId: OWNED_CONVERSATION_ID,
    })

    expect(response.status).toBe(404)
    const body = await response.json()
    expect(body.error.code).toBe('NOT_FOUND')
    expect(mockResolveOrCreateChat).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: OWNED_CONVERSATION_ID,
        userId: 'user-1',
        workspaceId: 'workspace-1',
      })
    )
    // No tokens may be billed against an id the caller could not be given.
    expect(mockRunHeadlessCopilotLifecycle).not.toHaveBeenCalled()
  })

  it('rejects a malformed conversation id before resolving anything', async () => {
    const response = await callChat({
      workspaceId: 'workspace-1',
      message: 'and then?',
      conversationId: 'not-a-conversation-id',
    })

    expect(response.status).toBe(400)
    expect(mockResolveOrCreateChat).not.toHaveBeenCalled()
    expect(mockRunHeadlessCopilotLifecycle).not.toHaveBeenCalled()
  })

  it('answers a failed run as a 500 with the run error', async () => {
    mockRunHeadlessCopilotLifecycle.mockResolvedValue({ success: false, error: 'model exploded' })

    const response = await callChat({ workspaceId: 'workspace-1', message: 'hi' })

    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.error.message).toBe('model exploded')
  })

  it('streams heartbeats, chunks, and a final event for NDJSON callers', async () => {
    mockRunHeadlessCopilotLifecycle.mockImplementation(
      async (_payload: unknown, options: { onEvent?: (event: unknown) => Promise<void> }) => {
        await options.onEvent?.({
          type: 'text',
          payload: { channel: 'assistant', text: 'Hello' },
        })
        await options.onEvent?.({
          type: 'text',
          payload: { channel: 'assistant', text: 'Hello there' },
        })
        return successResult
      }
    )

    const response = await callChat(
      { workspaceId: 'workspace-1', message: 'hi' },
      { accept: 'application/x-ndjson' }
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/x-ndjson')
    const events = await readNdjsonEvents(response)

    expect(events[0].type).toBe('heartbeat')
    const chunks = events.filter((event) => event.type === 'chunk')
    expect(chunks.map((chunk) => chunk.content)).toEqual(['Hello', ' there'])
    const final = events.at(-1) as { type: string; data: Record<string, unknown> }
    expect(final.type).toBe('final')
    expect(final.data).toMatchObject({
      content: 'Hello there',
      conversationId: SERVER_ISSUED_CHAT_ID,
    })
  })

  it('ends the NDJSON stream with an error event when the run fails', async () => {
    mockRunHeadlessCopilotLifecycle.mockResolvedValue({ success: false, error: 'model exploded' })

    const response = await callChat(
      { workspaceId: 'workspace-1', message: 'hi' },
      { accept: 'application/x-ndjson' }
    )

    expect(response.status).toBe(200)
    const events = await readNdjsonEvents(response)
    const last = events.at(-1) as { type: string; error?: string }
    expect(last.type).toBe('error')
    expect(last.error).toBe('model exploded')
  })
})

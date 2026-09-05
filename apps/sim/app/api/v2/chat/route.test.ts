/**
 * @vitest-environment node
 */

import {
  createMockRequest,
  permissionGroupScopeMock,
  permissionGroupScopeMockFns,
} from '@sim/testing'
import { sleep } from '@sim/utils/helpers'
import { NextRequest } from 'next/server'
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
  mockPersistCopilotChatTurn,
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
  mockPersistCopilotChatTurn: vi.fn(),
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

vi.mock('@/lib/copilot/chat/messages-store', () => ({
  persistCopilotChatTurn: mockPersistCopilotChatTurn,
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

vi.mock('@/lib/permission-groups/config-scope.server', () => permissionGroupScopeMock)

const mockResolvePermissionGroupConfig =
  permissionGroupScopeMockFns.mockResolvePermissionGroupConfig

import { chatOperations } from '@/lib/copilot/application/operations'
import { CAPABILITY_RULES } from '@/lib/permission-groups/capabilities'
import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'
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

/** How long a stream read may stay pending before it counts as "nothing more yet". */
const IDLE_STREAM_MS = 20

function chatRow(id: string) {
  return { id, userId: 'user-1', workspaceId: 'workspace-1', workflowId: null, type: 'mothership' }
}

const successResult = {
  success: true,
  content: 'Hello there',
  contentBlocks: [],
  toolCalls: [{ name: 'run_workflow' }, { name: 'internal_only' }],
  usage: { prompt: 10, completion: 5 },
  cost: { total: 0.01 },
}

function callChat(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  const req = createMockRequest('POST', body, { 'X-API-Key': 'test-key', ...headers })
  return POST(req, { params: Promise.resolve({}) })
}

/**
 * Same call, but over a request whose signal the test controls — the only way
 * to reproduce a caller that hangs up while the turn is still running.
 */
function callChatWithSignal(
  body: Record<string, unknown>,
  signal: AbortSignal,
  headers: Record<string, string> = {}
) {
  const req = new NextRequest(new URL('http://localhost:3000/api/v2/chat'), {
    method: 'POST',
    headers: new Headers({
      'Content-Type': 'application/json',
      'X-API-Key': 'test-key',
      ...headers,
    }),
    body: JSON.stringify(body),
    signal,
  })
  return POST(req, { params: Promise.resolve({}) })
}

/**
 * Read an NDJSON response incrementally. `drain()` returns the events that have
 * already reached the caller and stops as soon as the producer goes quiet;
 * `rest()` reads to the end. A pending read is held across calls so no chunk is
 * dropped between the two.
 */
function readNdjsonStream(response: Response) {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffered = ''
  let pending: Promise<ReadableStreamReadResult<Uint8Array>> | null = null

  const parse = (): Array<Record<string, unknown>> => {
    const lines = buffered.split('\n')
    buffered = lines.pop() ?? ''
    return lines.filter((line) => line.trim().length > 0).map((line) => JSON.parse(line))
  }

  const step = async (): Promise<'idle' | 'done' | 'chunk'> => {
    pending ??= reader.read()
    const settled = await Promise.race([
      pending.then((result) => ({ result })),
      sleep(IDLE_STREAM_MS).then(() => null),
    ])
    if (!settled) return 'idle'
    pending = null
    if (settled.result.done) return 'done'
    buffered += decoder.decode(settled.result.value, { stream: true })
    return 'chunk'
  }

  return {
    async drain() {
      const events: Array<Record<string, unknown>> = []
      for (;;) {
        const state = await step()
        events.push(...parse())
        if (state !== 'chunk') return events
      }
    },
    async rest() {
      const events: Array<Record<string, unknown>> = []
      for (;;) {
        const state = await step()
        events.push(...parse())
        if (state === 'done') return events
      }
    },
  }
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
    mockAssertActiveWorkspaceAccess.mockResolvedValue({
      permission: 'admin',
      workspace: { organizationId: null, allowPersonalApiKeys: true },
    })
    mockResolvePermissionGroupConfig.mockResolvedValue(null)
    mockResolveBillingAttribution.mockResolvedValue(billingAttributionSnapshot)
    mockRequestExplicitStreamAbort.mockResolvedValue(undefined)
    mockPersistCopilotChatTurn.mockResolvedValue(undefined)
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
      new MockV2ApiKeyUnauthenticatedError('API key or OAuth access token required')
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

  /**
   * `admitV2Request` authenticates and rate-limits but never authorizes, so
   * nothing but this route applies the capability `chat.send` declares.
   */
  it('answers 403 when the permission group withholds copilot.use', async () => {
    mockResolvePermissionGroupConfig.mockResolvedValue({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      hideCopilot: true,
    })

    const response = await callChat({ workspaceId: 'workspace-1', message: 'hi' })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'FORBIDDEN',
        message: "Chat is not available under your organization's permission group",
        details: { code: CAPABILITY_RULES[chatOperations.send.capability].detailCode },
      },
    })
    expect(mockResolveOrCreateChat).not.toHaveBeenCalled()
    expect(mockRunHeadlessCopilotLifecycle).not.toHaveBeenCalled()
  })

  /**
   * The route only runs for a user-held credential, and `admitV2Request` never
   * authorizes, so both halves of the funnel's credential policy have to be
   * repeated here. The workspace column is the first half.
   */
  it('answers 403 when the workspace has switched personal API keys off', async () => {
    mockAssertActiveWorkspaceAccess.mockResolvedValue({
      permission: 'admin',
      workspace: { organizationId: null, allowPersonalApiKeys: false },
    })

    const response = await callChat({ workspaceId: 'workspace-1', message: 'hi' })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'FORBIDDEN',
        message: 'Personal API keys are not allowed for this workspace',
        details: { code: 'PERSONAL_API_KEYS_DISABLED' },
      },
    })
    expect(mockResolveOrCreateChat).not.toHaveBeenCalled()
    expect(mockRunHeadlessCopilotLifecycle).not.toHaveBeenCalled()
  })

  /**
   * The group half. The column and the key combine with AND, so a workspace
   * that allows personal keys still refuses the cohort whose group withholds
   * them — the case `copilot.use` alone could never see.
   */
  it('answers 403 when the permission group withholds personal_api_key.use', async () => {
    mockAssertActiveWorkspaceAccess.mockResolvedValue({
      permission: 'admin',
      workspace: { organizationId: 'org-1', allowPersonalApiKeys: true },
    })
    mockResolvePermissionGroupConfig.mockResolvedValue({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      disablePersonalApiKeys: true,
    })

    const response = await callChat({ workspaceId: 'workspace-1', message: 'hi' })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'FORBIDDEN',
        message: 'Personal API keys are not allowed for this workspace',
        details: { code: 'PERSONAL_API_KEYS_DISABLED' },
      },
    })
    expect(mockResolveOrCreateChat).not.toHaveBeenCalled()
    expect(mockRunHeadlessCopilotLifecycle).not.toHaveBeenCalled()
  })

  /** A workspace with no organization resolves no group, so the key passes. */
  it('runs one turn for a personal key in a workspace no group governs', async () => {
    mockAssertActiveWorkspaceAccess.mockResolvedValue({
      permission: 'admin',
      workspace: { organizationId: null, allowPersonalApiKeys: true },
    })
    mockResolvePermissionGroupConfig.mockResolvedValue({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      disablePersonalApiKeys: true,
    })

    const response = await callChat({ workspaceId: 'workspace-1', message: 'hi' })

    expect(response.status).toBe(200)
    expect(mockRunHeadlessCopilotLifecycle).toHaveBeenCalledTimes(1)
  })

  /** Workspace reach is decided first, so the refusal cannot name a group to an outsider. */
  it('refuses an inaccessible workspace before consulting a permission group', async () => {
    mockAssertActiveWorkspaceAccess.mockRejectedValue(new MockWorkspaceAccessDeniedError('denied'))
    mockResolvePermissionGroupConfig.mockResolvedValue({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      hideCopilot: true,
    })

    const response = await callChat({ workspaceId: 'workspace-1', message: 'hi' })

    expect(response.status).toBe(403)
    expect(mockResolvePermissionGroupConfig).not.toHaveBeenCalled()
  })

  it('runs one turn when a group governs the caller but withholds nothing', async () => {
    mockResolvePermissionGroupConfig.mockResolvedValue(DEFAULT_PERMISSION_GROUP_CONFIG)

    const response = await callChat({ workspaceId: 'workspace-1', message: 'hi' })

    expect(response.status).toBe(200)
    expect(mockRunHeadlessCopilotLifecycle).toHaveBeenCalledTimes(1)
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

  it('posts only the current turn on a resumed conversation, never the stored transcript', async () => {
    mockResolveOrCreateChat.mockResolvedValue({
      chatId: OWNED_CONVERSATION_ID,
      chat: chatRow(OWNED_CONVERSATION_ID),
      conversationHistory: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'first reply' },
      ],
      isNew: false,
    })

    const response = await callChat({
      workspaceId: 'workspace-1',
      message: 'and then?',
      conversationId: OWNED_CONVERSATION_ID,
    })

    expect(response.status).toBe(200)
    // Continuity is keyed by chatId downstream, exactly as the web send path
    // and the Sim Chat block do. Replaying the transcript here would duplicate
    // every prior turn.
    expect(mockRunHeadlessCopilotLifecycle.mock.calls[0][0]).toMatchObject({
      messages: [{ role: 'user', content: 'and then?' }],
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

  it('asks the resolver for a mothership conversation, so another type resolves to nothing', async () => {
    await callChat({
      workspaceId: 'workspace-1',
      message: 'and then?',
      conversationId: OWNED_CONVERSATION_ID,
    })

    expect(mockResolveOrCreateChat).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: OWNED_CONVERSATION_ID, type: 'mothership' })
    )
  })

  it('titles a new conversation by its first message so the web Chat list has no blank row', async () => {
    await callChat({ workspaceId: 'workspace-1', message: '  Summarize\n  last week   ' })

    expect(mockResolveOrCreateChat).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Summarize last week' })
    )
  })

  it('truncates a long first message into a title instead of storing the whole message', async () => {
    const message = 'a'.repeat(500)

    await callChat({ workspaceId: 'workspace-1', message })

    const title = (mockResolveOrCreateChat.mock.calls[0][0] as { title?: string }).title
    expect(title).toBe(`${'a'.repeat(80)}...`)
  })

  it('leaves the title unset for a whitespace-only message rather than stamping an empty one', async () => {
    await callChat({ workspaceId: 'workspace-1', message: '   \n  ' })

    const resolverInput = mockResolveOrCreateChat.mock.calls[0][0] as Record<string, unknown>
    expect(Object.hasOwn(resolverInput, 'title')).toBe(false)
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
    mockRunHeadlessCopilotLifecycle.mockResolvedValue({
      success: false,
      error: 'model exploded',
      contentBlocks: [],
    })

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

  it('persists both sides of the turn so the conversation is not an empty transcript', async () => {
    await callChat({ workspaceId: 'workspace-1', message: 'hi' })

    expect(mockPersistCopilotChatTurn).toHaveBeenCalledTimes(1)
    const [chatId, messages] = mockPersistCopilotChatTurn.mock.calls[0]
    expect(chatId).toBe(SERVER_ISSUED_CHAT_ID)
    expect(messages.map((m: { role: string; content: string }) => [m.role, m.content])).toEqual([
      ['user', 'hi'],
      ['assistant', 'Hello there'],
    ])
  })

  it('persists the turn on the NDJSON path before the final event reaches the caller', async () => {
    // Hold the transcript write open and watch the wire: draining the whole
    // response first would pass just as happily with the write moved after the
    // final event, so the write is gated and the stream read incrementally.
    let persistEntered: () => void = () => {}
    const persistInFlight = new Promise<void>((resolve) => {
      persistEntered = resolve
    })
    let releasePersist: () => void = () => {}
    mockPersistCopilotChatTurn.mockImplementation(() => {
      persistEntered()
      return new Promise<void>((resolve) => {
        releasePersist = resolve
      })
    })

    const response = await callChat(
      { workspaceId: 'workspace-1', message: 'hi' },
      { accept: 'application/x-ndjson' }
    )
    const stream = readNdjsonStream(response)

    await persistInFlight
    const beforeRelease = await stream.drain()
    expect(beforeRelease.map((event) => event.type)).not.toContain('final')

    releasePersist()
    const afterRelease = await stream.rest()
    expect(afterRelease.at(-1)?.type).toBe('final')

    expect(mockPersistCopilotChatTurn).toHaveBeenCalledTimes(1)
    expect(mockPersistCopilotChatTurn.mock.calls[0][1]).toHaveLength(2)
  })

  it('persists a completed turn whose caller hung up, and still reports it as client-closed', async () => {
    const controller = new AbortController()
    mockRunHeadlessCopilotLifecycle.mockImplementation(async () => {
      controller.abort()
      return successResult
    })

    const response = await callChatWithSignal(
      { workspaceId: 'workspace-1', message: 'hi' },
      controller.signal
    )

    // The model already ran and was billed, so the reply is written to the
    // conversation it belongs to — but the caller is gone, and the status the
    // route reports says exactly that.
    expect(response.status).toBe(499)
    const body = await response.json()
    expect(body.error.code).toBe('CLIENT_CLOSED_REQUEST')
    expect(mockPersistCopilotChatTurn).toHaveBeenCalledTimes(1)
    expect(mockPersistCopilotChatTurn.mock.calls[0][0]).toBe(SERVER_ISSUED_CHAT_ID)
  })

  it('persists a completed turn whose NDJSON caller hung up, and still ends in an abort event', async () => {
    const controller = new AbortController()
    mockRunHeadlessCopilotLifecycle.mockImplementation(async () => {
      controller.abort()
      return successResult
    })

    const response = await callChatWithSignal(
      { workspaceId: 'workspace-1', message: 'hi' },
      controller.signal,
      { accept: 'application/x-ndjson' }
    )
    const events = await readNdjsonEvents(response)

    const last = events.at(-1) as { type: string; error?: string }
    expect(last.type).toBe('error')
    expect(last.error).toBe('Chat request aborted')
    expect(mockPersistCopilotChatTurn).toHaveBeenCalledTimes(1)
  })

  it('persists nothing for a failed run whose caller hung up', async () => {
    const controller = new AbortController()
    mockRunHeadlessCopilotLifecycle.mockImplementation(async () => {
      controller.abort()
      return { success: false, error: 'model exploded' }
    })

    const response = await callChatWithSignal(
      { workspaceId: 'workspace-1', message: 'hi' },
      controller.signal
    )

    expect(response.status).toBe(499)
    expect(mockPersistCopilotChatTurn).not.toHaveBeenCalled()
  })

  it('persists nothing when the run fails, so no question is stored without its answer', async () => {
    mockRunHeadlessCopilotLifecycle.mockResolvedValue({
      success: false,
      error: 'model exploded',
      contentBlocks: [],
    })

    const response = await callChat({ workspaceId: 'workspace-1', message: 'hi' })

    expect(response.status).toBe(500)
    expect(mockPersistCopilotChatTurn).not.toHaveBeenCalled()
  })

  it('still answers the caller when persisting the transcript fails', async () => {
    mockPersistCopilotChatTurn.mockRejectedValue(new Error('transcript write failed'))

    const response = await callChat({ workspaceId: 'workspace-1', message: 'hi' })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data).toMatchObject({
      content: 'Hello there',
      conversationId: SERVER_ISSUED_CHAT_ID,
    })
  })
})

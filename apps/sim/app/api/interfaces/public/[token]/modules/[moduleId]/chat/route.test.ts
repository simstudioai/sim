/**
 * @vitest-environment node
 *
 * Anonymous execution is the highest-blast-radius surface in this feature: it
 * spends the workspace's compute and billing quota. These tests pin the four
 * things that must never regress — the `execute` rate-limit layers (§2.8), the
 * `checkDeployment`/`checkRateLimit` flags that keep draft state unreachable and
 * the plan limit attached (§2.7), the same-workspace re-assert on the resolved
 * workflow (§2.3 STEP 5), and server-side `selectedOutputs` (§2.6).
 */
import { executionPreprocessingMock, executionPreprocessingMockFns } from '@sim/testing'
import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockEnforcePerIp,
  mockEnforcePerShare,
  mockResolvePublicInterfaceModule,
  mockTryAdmit,
  mockAdmissionRejectedResponse,
  mockRelease,
  mockReleaseExecutionSlot,
  mockCreateExecutionEventStream,
  mockExecuteWorkflow,
} = vi.hoisted(() => ({
  mockEnforcePerIp: vi.fn(),
  mockEnforcePerShare: vi.fn(),
  mockResolvePublicInterfaceModule: vi.fn(),
  mockTryAdmit: vi.fn(),
  mockAdmissionRejectedResponse: vi.fn(),
  mockRelease: vi.fn(),
  mockReleaseExecutionSlot: vi.fn(),
  mockCreateExecutionEventStream: vi.fn(),
  mockExecuteWorkflow: vi.fn(),
}))

vi.mock('@/lib/public-shares/rate-limit', () => ({
  enforcePerIpRateLimit: mockEnforcePerIp,
  enforcePerShareRateLimit: mockEnforcePerShare,
}))

vi.mock('@/lib/public-shares/interface-access', () => ({
  resolvePublicInterfaceModule: mockResolvePublicInterfaceModule,
}))

vi.mock('@/lib/core/admission/gate', () => ({
  tryAdmit: mockTryAdmit,
  admissionRejectedResponse: mockAdmissionRejectedResponse,
}))

vi.mock('@/lib/billing/calculations/usage-reservation', () => ({
  releaseExecutionSlot: mockReleaseExecutionSlot,
}))

vi.mock('@/lib/workflows/streaming/execution-event-stream', () => ({
  createExecutionEventStream: mockCreateExecutionEventStream,
}))

vi.mock('@/lib/workflows/executor/execute-workflow', () => ({
  executeWorkflow: mockExecuteWorkflow,
}))

vi.mock('@/lib/logs/execution/logging-session', () => ({
  LoggingSession: class {
    safeStart = vi.fn()
    safeComplete = vi.fn()
    safeCompleteWithError = vi.fn()
  },
}))

vi.mock('@/lib/execution/preprocessing', () => executionPreprocessingMock)

import { POST } from '@/app/api/interfaces/public/[token]/modules/[moduleId]/chat/route'

const TOKEN = 'tok_1'
const MODULE_ID = 'mod-chat'
const WS = 'ws-a'
const OTHER_WS = 'ws-b'
const WORKFLOW_ID = 'wf-stored'

const params = (token = TOKEN, moduleId = MODULE_ID) => ({
  params: Promise.resolve({ token, moduleId }),
})

const postRequest = (body: unknown) =>
  new NextRequest(`http://localhost/api/interfaces/public/${TOKEN}/modules/${MODULE_ID}/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

const chatModule = {
  id: MODULE_ID,
  type: 'chat' as const,
  placement: { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
  config: {
    workflowId: WORKFLOW_ID,
    outputConfigs: [{ blockId: 'block-stored', path: 'content' }],
    showThinking: false,
    welcomeMessage: 'Hi',
  },
}

const access = {
  share: { id: 'sh_1', token: TOKEN, authType: 'public', password: null },
  definition: {
    id: 'int-a',
    workspaceId: WS,
    name: 'Support desk',
    description: null,
    layout: { version: 1, grid: { rows: 2, cols: 2 }, modules: [chatModule] },
    createdBy: 'owner-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    archivedAt: null,
  },
  workspaceId: WS,
  module: chatModule,
  resource: { type: 'workflow' as const, id: WORKFLOW_ID },
}

function preprocessSuccess(workspaceId = WS) {
  return {
    success: true,
    actorUserId: 'system-actor',
    billingAttribution: { actorUserId: 'system-actor', workspaceId },
    workflowRecord: {
      id: WORKFLOW_ID,
      userId: 'owner-1',
      workspaceId,
      isDeployed: true,
      variables: {},
    },
  }
}

describe('POST /api/interfaces/public/[token]/modules/[moduleId]/chat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnforcePerIp.mockResolvedValue(null)
    mockEnforcePerShare.mockResolvedValue(null)
    mockTryAdmit.mockReturnValue({ release: mockRelease })
    mockAdmissionRejectedResponse.mockReturnValue(
      NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    )
    mockResolvePublicInterfaceModule.mockResolvedValue({ ok: true, access })
    executionPreprocessingMockFns.mockPreprocessExecution.mockResolvedValue(preprocessSuccess())
    mockCreateExecutionEventStream.mockReturnValue(new ReadableStream())
  })

  it('returns 429 from the per-IP execute bucket before anything else', async () => {
    mockEnforcePerIp.mockResolvedValueOnce(
      NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 })
    )
    const res = await POST(postRequest({ input: { input: 'hi' } }), params())
    expect(res.status).toBe(429)
    expect(mockResolvePublicInterfaceModule).not.toHaveBeenCalled()
    expect(executionPreprocessingMockFns.mockPreprocessExecution).not.toHaveBeenCalled()
  })

  it('uses the execute rate-limit scope', async () => {
    await POST(postRequest({ input: { input: 'hi' } }), params())
    expect(mockEnforcePerIp).toHaveBeenCalledWith(expect.anything(), 'execute')
  })

  /**
   * Each token-bucket read is a *consume*, not a peek, so charging the per-IP
   * bucket a second time for the per-share check would silently halve its
   * effective limit. Exactly one debit per request.
   */
  it('consumes the per-IP execute bucket exactly once', async () => {
    await POST(postRequest({ input: { input: 'hi' } }), params())
    expect(mockEnforcePerIp).toHaveBeenCalledTimes(1)
  })

  /**
   * §2.8 layer 3 — the per-IP bucket alone does not bound a link that is passed
   * around, so an aggregate per-share bucket is enforced once the share id is
   * known (i.e. after the chain resolves).
   */
  it('enforces the per-share execute bucket with the resolved share id', async () => {
    await POST(postRequest({ input: { input: 'hi' } }), params())
    expect(mockEnforcePerShare).toHaveBeenCalledTimes(1)
    expect(mockEnforcePerShare).toHaveBeenCalledWith('execute', 'sh_1')
  })

  it('stops on the per-share bucket without running the workflow', async () => {
    mockEnforcePerShare.mockResolvedValueOnce(
      NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 })
    )
    const res = await POST(postRequest({ input: { input: 'hi' } }), params())
    expect(res.status).toBe(429)
    expect(executionPreprocessingMockFns.mockPreprocessExecution).not.toHaveBeenCalled()
  })

  it('returns the admission-gate rejection at capacity', async () => {
    mockTryAdmit.mockReturnValueOnce(null)
    const res = await POST(postRequest({ input: { input: 'hi' } }), params())
    expect(res.status).toBe(429)
    expect(executionPreprocessingMockFns.mockPreprocessExecution).not.toHaveBeenCalled()
  })

  it('releases the admission ticket even when the run fails', async () => {
    mockCreateExecutionEventStream.mockImplementationOnce(() => {
      throw new Error('boom')
    })
    await POST(postRequest({ input: { input: 'hi' } }), params())
    expect(mockRelease).toHaveBeenCalled()
  })

  it('runs the chain with the chat type pinned', async () => {
    await POST(postRequest({ input: { input: 'hi' } }), params())
    expect(mockResolvePublicInterfaceModule).toHaveBeenCalledWith(
      expect.objectContaining({ token: TOKEN, moduleId: MODULE_ID, expectedType: 'chat' })
    )
  })

  it('propagates a 401 from the gate without executing anything', async () => {
    mockResolvePublicInterfaceModule.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({ error: 'auth_required_password' }, { status: 401 }),
    })
    const res = await POST(postRequest({ input: { input: 'hi' } }), params())
    expect(res.status).toBe(401)
    expect(executionPreprocessingMockFns.mockPreprocessExecution).not.toHaveBeenCalled()
    expect(mockRelease).toHaveBeenCalled()
  })

  /**
   * §2.7 — publicly there is no session, so draft state must never be reachable
   * and the per-actor plan limit must stay attached.
   */
  it('requires deployment and the plan rate limit', async () => {
    await POST(postRequest({ input: { input: 'hi' } }), params())
    expect(executionPreprocessingMockFns.mockPreprocessExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: WORKFLOW_ID,
        triggerType: 'chat',
        checkDeployment: true,
        checkRateLimit: true,
      })
    )
  })

  /**
   * §2.8 — a public run bills the workspace system actor, never the sharer
   * personally, so the authenticated-actor flag must be absent.
   */
  it('never bills the share creator as the actor', async () => {
    await POST(postRequest({ input: { input: 'hi' } }), params())
    const args = executionPreprocessingMockFns.mockPreprocessExecution.mock.calls[0][0]
    expect(args.useAuthenticatedUserAsActor).toBeFalsy()
  })

  it('runs the workflow derived from the stored layout, not the request', async () => {
    await POST(
      postRequest({ input: { input: 'hi' }, workflowId: 'wf-attacker', useDraftState: true }),
      params()
    )
    const args = executionPreprocessingMockFns.mockPreprocessExecution.mock.calls[0][0]
    expect(args.workflowId).toBe(WORKFLOW_ID)
    expect(args.useDraftState).toBeUndefined()
  })

  it('404s and releases the billing slot when the workflow is in another workspace', async () => {
    executionPreprocessingMockFns.mockPreprocessExecution.mockResolvedValueOnce(
      preprocessSuccess(OTHER_WS)
    )
    const res = await POST(postRequest({ input: { input: 'hi' } }), params())
    expect(res.status).toBe(404)
    expect(mockReleaseExecutionSlot).toHaveBeenCalled()
    expect(mockCreateExecutionEventStream).not.toHaveBeenCalled()
  })

  it.each([
    [403, 'Workflow is not deployed'],
    [402, 'Usage limit exceeded'],
    [429, 'Rate limit exceeded'],
  ])('preserves the preprocessing status %s', async (statusCode, message) => {
    executionPreprocessingMockFns.mockPreprocessExecution.mockResolvedValueOnce({
      success: false,
      error: { message, statusCode },
    })
    const res = await POST(postRequest({ input: { input: 'hi' } }), params())
    expect(res.status).toBe(statusCode)
    expect(mockCreateExecutionEventStream).not.toHaveBeenCalled()
  })

  /**
   * §6.6 — an anonymous visitor is never told "not deployed", a plan name, or a
   * usage limit. That is internal workspace state: the status code survives, the
   * reason does not.
   */
  it.each([
    [403, 'Workflow wf-stored is not deployed'],
    [402, 'Usage limit exceeded on the Pro plan'],
  ])('never leaks the internal reason behind a %s', async (statusCode, message) => {
    executionPreprocessingMockFns.mockPreprocessExecution.mockResolvedValueOnce({
      success: false,
      error: { message, statusCode },
    })
    const res = await POST(postRequest({ input: { input: 'hi' } }), params())
    const body = JSON.stringify(await res.json())
    expect(body).not.toContain('deployed')
    expect(body).not.toContain('Pro plan')
    expect(body).not.toContain(WORKFLOW_ID)
  })

  /**
   * §2.6 — publicly, `selectedOutputs` is a client-controlled output selector
   * over the workflow's blocks, so it is serialized server-side from the stored
   * module config and the request's copy is ignored entirely.
   */
  it('builds selectedOutputs from the stored module config', async () => {
    await POST(
      postRequest({ input: { input: 'hi' }, selectedOutputs: ['block-attacker_apiKey'] }),
      params()
    )
    expect(mockCreateExecutionEventStream).toHaveBeenCalledTimes(1)
    const streamArgs = mockCreateExecutionEventStream.mock.calls[0][0]
    await streamArgs.executeFn({
      onStream: vi.fn(),
      onBlockStart: vi.fn(),
      onBlockComplete: vi.fn(),
      abortSignal: new AbortController().signal,
    })
    expect(mockExecuteWorkflow.mock.calls[0][4].selectedOutputs).toEqual(['block-stored_content'])
  })

  /**
   * §2.6 — the same stored selection bounds what the stream may show. Anything
   * outside it is an intermediate block the module never published, and the
   * viewer is anonymous.
   *
   * Bounded by PATH, not just by block: an agent block's output carries
   * `toolCalls.list`, whose entries hold the literal arguments sent to every
   * tool and the literal response that came back. Publishing `content` must
   * expose `content` alone.
   */
  it('exposes only the stored selection blocks and paths to the viewer', async () => {
    await POST(
      postRequest({ input: { input: 'hi' }, selectedOutputs: ['block-attacker_apiKey'] }),
      params()
    )
    const streamArgs = mockCreateExecutionEventStream.mock.calls[0][0]
    const published = streamArgs.publishedOutputs as Map<string, Set<string>>

    expect([...published.keys()]).toEqual(['block-stored'])
    expect([...(published.get('block-stored') ?? [])]).toEqual(['content'])
    expect(published.has('block-attacker')).toBe(false)
  })

  it('rejects an empty message before resolving the token', async () => {
    const res = await POST(postRequest({ input: { input: '' } }), params())
    expect(res.status).toBe(400)
    expect(mockResolvePublicInterfaceModule).not.toHaveBeenCalled()
  })

  it('streams a successful run with SSE headers', async () => {
    const res = await POST(postRequest({ input: { input: 'hi' } }), params())
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/event-stream')
    expect(mockRelease).toHaveBeenCalled()
  })
})

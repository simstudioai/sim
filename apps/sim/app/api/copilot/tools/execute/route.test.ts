/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const { mockCheckInternalApiKey, mockPrepareEnvironmentContext, mockHandler } = vi.hoisted(() => ({
  mockCheckInternalApiKey: vi.fn(),
  mockPrepareEnvironmentContext: vi.fn(),
  mockHandler: vi.fn(),
}))

vi.mock('@/lib/mothership/request/http', () => ({
  checkInternalApiKey: mockCheckInternalApiKey,
}))

vi.mock('@/lib/mothership/environment-context', () => ({
  prepareCopilotEnvironmentContext: mockPrepareEnvironmentContext,
}))

vi.mock('@/lib/mothership/tool-executor', () => ({
  ensureHandlersRegistered: vi.fn(),
}))

vi.mock('@/lib/mothership/tool-executor/executor', () => ({
  executeTool: (
    _toolName: string,
    params: Record<string, unknown>,
    context: Record<string, unknown>
  ) => mockHandler(params, context),
}))

vi.mock('@/lib/mothership/request/tools/resources', () => ({
  handleResourceSideEffects: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/mothership/request/otel', () => ({
  withIncomingGoSpan: (
    _headers: Headers,
    _span: string,
    _attrs: undefined,
    fn: (span: { setAttributes: () => void }) => Promise<Response>
  ) => fn({ setAttributes: () => {} }),
}))

import { POST } from '@/app/api/copilot/tools/execute/route'

function makeRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/copilot/tools/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const BASE_BODY = {
  toolCallId: 'call-1',
  toolName: 'read',
  params: { path: 'files/a.md' },
  userId: 'user-1',
  workspaceId: 'ws-1',
  chatId: 'chat-1',
  messageId: 'msg-1',
}

describe('POST /api/copilot/tools/execute (in-band)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckInternalApiKey.mockReturnValue({ success: true })
    // A fresh, complete registry per test: the module-level turn cache is keyed
    // by messageId, so each test uses a distinct messageId to avoid cross-test
    // cache hits.
    mockPrepareEnvironmentContext.mockImplementation(async () => ({
      resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry([]),
    }))
  })

  it('threads a per-call registry fork into the handler and returns the projected result', async () => {
    mockHandler.mockResolvedValue({ success: true, output: { content: 'hello' } })
    const res = await POST(makeRequest({ ...BASE_BODY, messageId: 'msg-fork' }) as never)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ success: true, output: { content: 'hello' } })

    const [, handlerContext] = mockHandler.mock.calls[0]
    expect(handlerContext.resolvedSecretTraceRegistry).toBeInstanceOf(ResolvedSecretTraceRegistry)
    expect(handlerContext.userId).toBe('user-1')
    expect(handlerContext.copilotToolExecution).toBe(true)
  })

  it('keeps a clean tool failure message intact when the registry is available', async () => {
    mockHandler.mockResolvedValue({ success: false, error: 'File not found: files/a.md' })
    const res = await POST(makeRequest({ ...BASE_BODY, messageId: 'msg-clean-error' }) as never)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(body.error).toBe('File not found: files/a.md')
  })

  /**
   * Running the tool without a catalog used to produce the worst pair of outcomes available:
   * the side effect happened and the caller got a bare `{success: true}` naming neither the
   * cause nor whether anything had changed.
   */
  it('refuses the call, without running the tool, when no egress registry can be built', async () => {
    mockPrepareEnvironmentContext.mockRejectedValue(new Error('Workspace ws-gone does not exist'))
    mockHandler.mockResolvedValue({ success: true, output: { content: 'sensitive' } })

    const res = await POST(makeRequest({ ...BASE_BODY, messageId: 'msg-no-registry' }) as never)
    const body = await res.json()

    expect(mockHandler).not.toHaveBeenCalled()
    expect(body.success).toBe(false)
    expect(body.output).toEqual({ resultWithheld: true, effect: 'not_attempted' })
    // The thrown reason is an unprojectable environment failure — the catalog that would
    // vouch for it is the very thing missing — so it stays in the log.
    expect(body.error).not.toContain('does not exist')
    expect(body.error).toContain(BASE_BODY.workspaceId)
    expect(body.error).toContain('could not be resolved')
  })

  it('reuses one turn registry across calls that share a messageId', async () => {
    mockHandler.mockResolvedValue({ success: true, output: {} })
    await POST(makeRequest({ ...BASE_BODY, messageId: 'msg-shared' }) as never)
    await POST(
      makeRequest({ ...BASE_BODY, toolCallId: 'call-2', messageId: 'msg-shared' }) as never
    )
    expect(mockPrepareEnvironmentContext).toHaveBeenCalledTimes(1)
  })
})

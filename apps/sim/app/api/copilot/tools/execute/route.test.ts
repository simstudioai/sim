import { copilotHttpMock, copilotHttpMockFns } from '@sim/testing/mocks/copilot-http.mock'
import {
  mothershipEnvironmentContextMock,
  mothershipEnvironmentContextMockFns,
} from '@sim/testing/mocks/mothership-environment-context.mock'
import { mothershipOtelMock } from '@sim/testing/mocks/mothership-otel.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const { mockHandler, mockToolRequiresApprovalLane } = vi.hoisted(() => ({
  mockHandler: vi.fn(),
  mockToolRequiresApprovalLane: vi.fn().mockReturnValue(false),
}))

vi.mock('@/lib/mothership/request/http', () => copilotHttpMock)

vi.mock('@/lib/mothership/environment-context', () => mothershipEnvironmentContextMock)

vi.mock('@/lib/mothership/tool-executor', () => ({
  ensureHandlersRegistered: vi.fn(),
  toolRequiresApprovalLane: mockToolRequiresApprovalLane,
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

vi.mock('@/lib/mothership/request/otel', () => mothershipOtelMock)

import { POST } from '@/app/api/copilot/tools/execute/route'

const { mockCheckInternalApiKey } = copilotHttpMockFns

const mockPrepareEnvironmentContext =
  mothershipEnvironmentContextMockFns.mockPrepareCopilotEnvironmentContext

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
    mockCheckInternalApiKey.mockReturnValue({ success: true })
    mockToolRequiresApprovalLane.mockReturnValue(false)
    // A fresh, complete registry per test: the module-level turn cache is keyed
    // by messageId, so each test uses a distinct messageId to avoid cross-test
    // cache hits.
    mockPrepareEnvironmentContext.mockImplementation(async () => ({
      resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry([]),
    }))
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

  /**
   * The generated key is a browser-only artifact. This lane's response is what Go feeds the
   * model, so it must carry the same projection the resume lane produces — the status message
   * alone. A `key` field here would put the plaintext credential in model context.
   */
  it('returns only the status message for generate_api_key, never the key', async () => {
    const message = 'API key "demo" created. You did NOT receive the key value'
    mockHandler.mockResolvedValue({
      success: true,
      output: { id: 'key-1', name: 'demo', key: 'sk_live_plaintext', workspaceId: 'ws-1', message },
    })

    const res = await POST(
      makeRequest({
        ...BASE_BODY,
        toolName: 'generate_api_key',
        params: { name: 'demo' },
        messageId: 'msg-api-key',
      }) as never
    )
    const body = await res.json()

    expect(body).toEqual({ success: true, output: message })
    expect(JSON.stringify(body)).not.toContain('sk_live_plaintext')
  })

  /**
   * Whether a tool needs an approval-capable lane is decided by
   * `toolRequiresApprovalLane` (covered against the real flag and catalog in
   * the tool-executor router tests). What matters here is what the route does
   * with that answer.
   */
  describe('approval-gated tools', () => {
    /**
     * This lane cannot hold an approval prompt: the dispatch handler owns the gate and
     * declines to dispatch in-band calls, so a gated tool arriving here has no waiter behind
     * it. Refuse before running anything rather than execute on consent nobody gave.
     */
    it('refuses a tool that needs an approval-capable lane, without executing it', async () => {
      mockToolRequiresApprovalLane.mockReturnValue(true)
      mockHandler.mockResolvedValue({ success: true, output: { ran: true } })

      const res = await POST(
        makeRequest({
          ...BASE_BODY,
          toolName: 'run_function',
          params: { code: 'return 1' },
          messageId: 'msg-gated',
        }) as never
      )
      const body = await res.json()

      expect(mockHandler).not.toHaveBeenCalled()
      expect(body.success).toBe(false)
      expect(body.output).toEqual({ resultWithheld: true, effect: 'not_attempted' })
      expect(body.error).toContain('requires user approval')
      expect(body.error).toContain('checkpoint lane')
    })
  })
})

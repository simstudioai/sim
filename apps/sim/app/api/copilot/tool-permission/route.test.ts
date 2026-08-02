/**
 * @vitest-environment node
 */

import { createMockRequest, resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetSession,
  mockGetAsyncToolCall,
  mockGetRunSegment,
  mockRecordToolPermissionDecision,
  mockPublishToolPermissionDecision,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockGetAsyncToolCall: vi.fn(),
  mockGetRunSegment: vi.fn(),
  mockRecordToolPermissionDecision: vi.fn(),
  mockPublishToolPermissionDecision: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
  getSession: mockGetSession,
}))

vi.mock('@/lib/copilot/async-runs/repository', () => ({
  getAsyncToolCall: mockGetAsyncToolCall,
  getRunSegment: mockGetRunSegment,
  recordToolPermissionDecision: mockRecordToolPermissionDecision,
}))

vi.mock('@/lib/copilot/persistence/tool-permission', () => ({
  TOOL_PERMISSION_DECISION: {
    allow: 'allow',
    allow_chat: 'allow_chat',
    always_allow: 'always_allow',
    skip: 'skip',
  },
  publishToolPermissionDecision: mockPublishToolPermissionDecision,
}))

vi.mock('@/lib/copilot/persistence/tool-permission/auto-allow', () => ({
  addAutoAllowedTool: vi.fn(),
  addChatAutoAllowedTool: vi.fn(),
}))

vi.mock('@/lib/copilot/request/otel', () => ({
  withIncomingGoSpan: vi.fn(
    async (
      _headers: unknown,
      _spanName: unknown,
      _attributes: unknown,
      callback: (span: { setAttributes: (attributes: unknown) => void }) => Promise<Response>
    ) => callback({ setAttributes: vi.fn() })
  ),
}))

import { POST } from './route'

afterAll(resetEnvFlagsMock)

describe('Copilot tool permission decisions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setEnvFlags({ isCopilotToolPermissionsEnabled: false })
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetRunSegment.mockResolvedValue({ id: 'run-1', userId: 'user-1', chatId: 'chat-1' })
    mockRecordToolPermissionDecision.mockResolvedValue({
      toolCallId: 'call-1',
      toolName: 'function_execute',
      permissionDecidedAt: new Date('2026-08-01T00:00:00.000Z'),
    })
  })

  it('accepts one-call approval for a secret-bearing code call while the broad flag is off', async () => {
    mockGetAsyncToolCall.mockResolvedValue({
      runId: 'run-1',
      toolCallId: 'call-1',
      toolName: 'function_execute',
      args: { language: 'javascript', code: 'return {{API_KEY}}' },
      permissionDecision: null,
    })

    const response = await POST(
      createMockRequest(
        'POST',
        { decisions: [{ toolCallId: 'call-1', decision: 'allow' }] },
        {},
        'http://localhost:3000/api/copilot/tool-permission'
      )
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      results: [{ toolCallId: 'call-1', decision: 'allow', applied: true }],
    })
    expect(mockRecordToolPermissionDecision).toHaveBeenCalledWith('call-1', 'allow')
    expect(mockPublishToolPermissionDecision).toHaveBeenCalledWith(
      expect.objectContaining({ toolCallId: 'call-1', decision: 'allow' })
    )
  })

  it('keeps ordinary tool permission decisions closed while the broad flag is off', async () => {
    mockGetAsyncToolCall.mockResolvedValue({
      runId: 'run-1',
      toolCallId: 'call-1',
      toolName: 'terminal',
      args: { operation: 'run', args: { command: 'ls' } },
      permissionDecision: null,
    })

    const response = await POST(
      createMockRequest(
        'POST',
        { decisions: [{ toolCallId: 'call-1', decision: 'allow' }] },
        {},
        'http://localhost:3000/api/copilot/tool-permission'
      )
    )

    expect(response.status).toBe(404)
    expect(mockRecordToolPermissionDecision).not.toHaveBeenCalled()
  })

  it.each(['allow_chat', 'always_allow'] as const)(
    'rejects persistent %s approval for a secret-bearing code call',
    async (decision) => {
      mockGetAsyncToolCall.mockResolvedValue({
        runId: 'run-1',
        toolCallId: 'call-1',
        toolName: 'function_execute',
        args: { language: 'javascript', code: 'return {{API_KEY}}' },
        permissionDecision: null,
      })

      const response = await POST(
        createMockRequest(
          'POST',
          { decisions: [{ toolCallId: 'call-1', decision }] },
          {},
          'http://localhost:3000/api/copilot/tool-permission'
        )
      )

      expect(response.status).toBe(400)
      expect(mockRecordToolPermissionDecision).not.toHaveBeenCalled()
    }
  )
})

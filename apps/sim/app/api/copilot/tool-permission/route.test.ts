/**
 * @vitest-environment node
 */

import { copilotHttpMock, copilotHttpMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getAsyncToolCall,
  getRunSegment,
  recordToolPermissionDecision,
  publishToolPermissionDecision,
  addAutoAllowedTool,
  addChatAutoAllowedTool,
  getUserPermissionConfig,
} = vi.hoisted(() => ({
  getAsyncToolCall: vi.fn(),
  getRunSegment: vi.fn(),
  recordToolPermissionDecision: vi.fn(),
  publishToolPermissionDecision: vi.fn(),
  addAutoAllowedTool: vi.fn(),
  addChatAutoAllowedTool: vi.fn(),
  getUserPermissionConfig: vi.fn(),
}))

vi.mock('@/lib/copilot/request/http', () => copilotHttpMock)

vi.mock('@/lib/copilot/async-runs/repository', () => ({
  getAsyncToolCall,
  getRunSegment,
  recordToolPermissionDecision,
}))

vi.mock('@/lib/copilot/persistence/tool-permission', () => ({
  publishToolPermissionDecision,
  TOOL_PERMISSION_DECISION: {
    allow: 'allow',
    allow_chat: 'allow_chat',
    always_allow: 'always_allow',
    skip: 'skip',
  },
}))

vi.mock('@/lib/copilot/persistence/tool-permission/auto-allow', () => ({
  addAutoAllowedTool,
  addChatAutoAllowedTool,
}))

vi.mock('@/lib/core/config/env-flags', () => ({
  isCopilotToolPermissionsEnabled: true,
}))

vi.mock('@/ee/access-control/utils/permission-check', () => ({
  getUserPermissionConfig,
}))

import { POST } from './route'

describe('Copilot tool permission API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    copilotHttpMockFns.mockAuthenticateCopilotRequestSessionOnly.mockResolvedValue({
      userId: 'user-1',
      isAuthenticated: true,
    })
    getAsyncToolCall.mockResolvedValue({
      toolCallId: 'tool-1',
      runId: 'run-1',
      toolName: 'run_workflow',
      status: 'pending',
      permissionDecision: null,
    })
    getRunSegment.mockResolvedValue({
      id: 'run-1',
      userId: 'user-1',
      chatId: 'chat-1',
      workspaceId: 'workspace-1',
    })
    getUserPermissionConfig.mockResolvedValue(null)
    recordToolPermissionDecision.mockResolvedValue({
      toolCallId: 'tool-1',
      runId: 'run-1',
      toolName: 'run_workflow',
      status: 'pending',
      permissionDecision: 'allow',
      permissionDecidedAt: new Date('2026-08-01T00:00:00.000Z'),
    })
    addAutoAllowedTool.mockResolvedValue(undefined)
    addChatAutoAllowedTool.mockResolvedValue(undefined)
  })

  function createRequest(decision: 'allow' | 'allow_chat' | 'always_allow' | 'skip') {
    return new NextRequest('http://localhost:3000/api/copilot/tool-permission', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decisions: [{ toolCallId: 'tool-1', decision }] }),
    })
  }

  it.each(['allow', 'allow_chat', 'always_allow', 'skip'] as const)(
    'records the generic %s decision without changing execution state',
    async (decision) => {
      recordToolPermissionDecision.mockResolvedValueOnce({
        toolCallId: 'tool-1',
        runId: 'run-1',
        toolName: 'run_workflow',
        status: 'pending',
        permissionDecision: decision,
        permissionDecidedAt: new Date('2026-08-01T00:00:00.000Z'),
      })

      const response = await POST(createRequest(decision))

      expect(response.status).toBe(200)
      expect(recordToolPermissionDecision).toHaveBeenCalledWith('tool-1', decision)
      expect(publishToolPermissionDecision).toHaveBeenCalledWith(
        expect.objectContaining({ toolCallId: 'tool-1', decision })
      )
    }
  )

  it('uses the same decision path for non-workflow tools', async () => {
    const toolName = 'function_execute'
    const decision = 'allow'
    getAsyncToolCall.mockResolvedValueOnce({
      toolCallId: 'tool-1',
      runId: 'run-1',
      toolName,
      status: 'pending',
      permissionDecision: null,
    })
    recordToolPermissionDecision.mockResolvedValueOnce({
      toolCallId: 'tool-1',
      runId: 'run-1',
      toolName,
      status: 'pending',
      permissionDecision: decision,
      permissionDecidedAt: new Date('2026-08-01T00:00:00.000Z'),
    })

    const response = await POST(createRequest(decision))

    expect(response.status).toBe(200)
    expect(recordToolPermissionDecision).toHaveBeenCalledWith('tool-1', decision)
  })

  describe('when the permission group withholds tool auto-approval', () => {
    beforeEach(() => {
      getUserPermissionConfig.mockResolvedValue({ disableToolAutoApproval: true })
    })

    it.each(['always_allow', 'allow_chat'] as const)(
      'answers the %s prompt without remembering it',
      async (decision) => {
        recordToolPermissionDecision.mockResolvedValueOnce({
          toolCallId: 'tool-1',
          runId: 'run-1',
          toolName: 'run_workflow',
          status: 'pending',
          permissionDecision: decision,
          permissionDecidedAt: new Date('2026-08-01T00:00:00.000Z'),
        })

        const response = await POST(createRequest(decision))

        // The waiting orchestrator still gets its answer; only the durable
        // preference is refused, so the next call prompts again.
        expect(response.status).toBe(200)
        expect(publishToolPermissionDecision).toHaveBeenCalledWith(
          expect.objectContaining({ toolCallId: 'tool-1', decision })
        )
        expect(addAutoAllowedTool).not.toHaveBeenCalled()
        expect(addChatAutoAllowedTool).not.toHaveBeenCalled()
      }
    )

    it('remembers it again once the group allows it', async () => {
      getUserPermissionConfig.mockResolvedValue({ disableToolAutoApproval: false })
      recordToolPermissionDecision.mockResolvedValueOnce({
        toolCallId: 'tool-1',
        runId: 'run-1',
        toolName: 'run_workflow',
        status: 'pending',
        permissionDecision: 'always_allow',
        permissionDecidedAt: new Date('2026-08-01T00:00:00.000Z'),
      })

      await POST(createRequest('always_allow'))

      expect(addAutoAllowedTool).toHaveBeenCalledWith('user-1', 'run_workflow')
    })
  })
})

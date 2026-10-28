import { copilotHttpMock, copilotHttpMockFns } from '@sim/testing'
import { setEnvFlags } from '@sim/testing/mocks/env-flags.mock'
import {
  mothershipAsyncRunsMock,
  mothershipAsyncRunsMockFns,
} from '@sim/testing/mocks/mothership-async-runs.mock'
import {
  permissionGroupsResolveMock,
  permissionGroupsResolveMockFns,
} from '@sim/testing/mocks/permission-groups-resolve.mock'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { publishToolPermissionDecision, addAutoAllowedTool, addChatAutoAllowedTool } = vi.hoisted(
  () => ({
    publishToolPermissionDecision: vi.fn(),
    addAutoAllowedTool: vi.fn(),
    addChatAutoAllowedTool: vi.fn(),
  })
)

vi.mock('@/lib/mothership/request/http', () => copilotHttpMock)

vi.mock('@/lib/mothership/async-runs/repository', () => mothershipAsyncRunsMock)

vi.mock('@/lib/mothership/persistence/tool-permission', () => ({
  publishToolPermissionDecision,
  TOOL_PERMISSION_DECISION: {
    allow: 'allow',
    allow_chat: 'allow_chat',
    always_allow: 'always_allow',
    skip: 'skip',
  },
}))

vi.mock('@/lib/mothership/persistence/tool-permission/auto-allow', () => ({
  addAutoAllowedTool,
  addChatAutoAllowedTool,
}))

vi.mock('@/lib/permission-groups/resolve.server', () => permissionGroupsResolveMock)

import { POST } from './route'

const getAsyncToolCall = mothershipAsyncRunsMockFns.mockGetAsyncToolCall
const getRunSegment = mothershipAsyncRunsMockFns.mockGetRunSegment
const recordToolPermissionDecision = mothershipAsyncRunsMockFns.mockRecordToolPermissionDecision
const getUserPermissionConfig = permissionGroupsResolveMockFns.mockGetUserPermissionConfig
setEnvFlags({ isCopilotToolPermissionsEnabled: true })

describe('Copilot tool permission API', () => {
  beforeEach(() => {
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
    return createMockRequest({
      method: 'POST',
      url: 'http://localhost:3000/api/copilot/tool-permission',
      body: { decisions: [{ toolCallId: 'tool-1', decision }] },
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

    /**
     * The row is claimed before this lookup runs, so a rejection that escaped
     * would answer 500 with the decision unpublished — and the retry lands on
     * the already-answered branch, which does not republish, leaving the turn
     * to wait out its permission timeout.
     */
    it('answers the prompt when the lookup itself fails, remembering nothing', async () => {
      getUserPermissionConfig.mockRejectedValue(new Error('permission group lookup failed'))
      recordToolPermissionDecision.mockResolvedValueOnce({
        toolCallId: 'tool-1',
        runId: 'run-1',
        toolName: 'run_workflow',
        status: 'pending',
        permissionDecision: 'always_allow',
        permissionDecidedAt: new Date('2026-08-01T00:00:00.000Z'),
      })

      const response = await POST(createRequest('always_allow'))

      expect(response.status).toBe(200)
      expect(publishToolPermissionDecision).toHaveBeenCalledWith(
        expect.objectContaining({ toolCallId: 'tool-1', decision: 'always_allow' })
      )
      expect(addAutoAllowedTool).not.toHaveBeenCalled()
    })
  })
})

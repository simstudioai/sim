/**
 * @vitest-environment node
 */

import {
  authMockFns,
  permissionsMock,
  permissionsMockFns,
  workflowsUtilsMock,
  workflowsUtilsMockFns,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const resolveWorkflowIdForUser = workflowsUtilsMockFns.mockResolveWorkflowIdForUser
const getWorkflowById = workflowsUtilsMockFns.mockGetWorkflowById
const getUserEntityPermissions = permissionsMockFns.mockGetUserEntityPermissions

const {
  getEffectiveDecryptedEnv,
  generateWorkspaceContext,
  processContextsServer,
  resolveActiveResourceContext,
  buildCopilotRequestPayload,
  createSSEStream,
  acquirePendingChatStream,
  getPendingChatStreamId,
  releasePendingChatStream,
  resolveOrCreateChat,
} = vi.hoisted(() => ({
  getEffectiveDecryptedEnv: vi.fn(),
  generateWorkspaceContext: vi.fn(),
  processContextsServer: vi.fn(),
  resolveActiveResourceContext: vi.fn(),
  buildCopilotRequestPayload: vi.fn(),
  createSSEStream: vi.fn(),
  acquirePendingChatStream: vi.fn(),
  getPendingChatStreamId: vi.fn(),
  releasePendingChatStream: vi.fn(),
  resolveOrCreateChat: vi.fn(),
}))

const getSession = authMockFns.mockGetSession

vi.mock('@/lib/workflows/utils', () => workflowsUtilsMock)

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

vi.mock('@/lib/environment/utils', () => ({
  getEffectiveDecryptedEnv,
}))

vi.mock('@/lib/copilot/chat/workspace-context', () => ({
  generateWorkspaceContext,
}))

vi.mock('@/lib/copilot/chat/process-contents', () => ({
  processContextsServer,
  resolveActiveResourceContext,
}))

vi.mock('@/lib/copilot/chat/payload', () => ({
  buildCopilotRequestPayload,
}))

vi.mock('@/lib/copilot/request/lifecycle/start', () => ({
  createSSEStream,
  SSE_RESPONSE_HEADERS: { 'Content-Type': 'text/event-stream' },
}))

vi.mock('@/lib/copilot/request/session', () => ({
  acquirePendingChatStream,
  getPendingChatStreamId,
  releasePendingChatStream,
}))

vi.mock('@/lib/copilot/chat/lifecycle', () => ({
  resolveOrCreateChat,
}))

vi.mock('@/lib/copilot/tasks', () => ({
  taskPubSub: {
    publishStatusChanged: vi.fn(),
  },
}))

vi.mock('@sim/db', () => ({
  db: {
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue([]),
        })),
      })),
    })),
  },
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => ({})),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
}))

import { handleUnifiedChatPost } from './post'

describe('handleUnifiedChatPost', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getSession.mockResolvedValue({ user: { id: 'user-1' } })
    resolveWorkflowIdForUser.mockResolvedValue({
      status: 'resolved',
      workflowId: 'wf-1',
      workflowName: 'Workflow One',
    })
    getWorkflowById.mockResolvedValue({ workspaceId: 'ws-1' })
    getUserEntityPermissions.mockResolvedValue('write')
    getEffectiveDecryptedEnv.mockResolvedValue({ API_KEY: 'secret' })
    generateWorkspaceContext.mockResolvedValue('workspace context')
    processContextsServer.mockResolvedValue([])
    resolveActiveResourceContext.mockResolvedValue(null)
    buildCopilotRequestPayload.mockImplementation(async (params: Record<string, unknown>) => params)
    createSSEStream.mockReturnValue(new ReadableStream())
    acquirePendingChatStream.mockResolvedValue(true)
    getPendingChatStreamId.mockResolvedValue(null)
    releasePendingChatStream.mockResolvedValue(undefined)
    resolveOrCreateChat.mockResolvedValue({
      chatId: 'chat-1',
      chat: { id: 'chat-1' },
      conversationHistory: [],
      isNew: true,
    })
  })

  it('routes workflow-attached chat requests through the copilot backend path', async () => {
    const response = await handleUnifiedChatPost(
      new NextRequest('http://localhost/api/copilot/chat', {
        method: 'POST',
        body: JSON.stringify({
          message: 'Hello',
          workflowId: 'wf-1',
          workspaceId: 'ws-1',
        }),
      })
    )

    expect(response.status).toBe(200)
    expect(createSSEStream).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws-1',
        orchestrateOptions: expect.objectContaining({
          workflowId: 'wf-1',
          goRoute: '/api/copilot',
          executionContext: expect.objectContaining({
            userId: 'user-1',
            workflowId: 'wf-1',
            workspaceId: 'ws-1',
            requestMode: 'agent',
          }),
        }),
      })
    )
  })

  it('routes workspace chat requests through the mothership backend path', async () => {
    const response = await handleUnifiedChatPost(
      new NextRequest('http://localhost/api/copilot/chat', {
        method: 'POST',
        body: JSON.stringify({
          message: 'Hello',
          workspaceId: 'ws-1',
        }),
      })
    )

    expect(response.status).toBe(200)
    expect(buildCopilotRequestPayload).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws-1',
        workspaceContext: 'workspace context',
      }),
      { selectedModel: '' }
    )
    expect(createSSEStream).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws-1',
        orchestrateOptions: expect.objectContaining({
          workspaceId: 'ws-1',
          goRoute: '/api/mothership',
          executionContext: expect.objectContaining({
            userId: 'user-1',
            workflowId: '',
            workspaceId: 'ws-1',
            requestMode: 'agent',
          }),
        }),
      })
    )
  })

  it('rejects requests that have neither workflow nor workspace attachment', async () => {
    const response = await handleUnifiedChatPost(
      new NextRequest('http://localhost/api/copilot/chat', {
        method: 'POST',
        body: JSON.stringify({
          message: 'Hello',
        }),
      })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'workspaceId is required when workflowId is not provided',
    })
  })
})

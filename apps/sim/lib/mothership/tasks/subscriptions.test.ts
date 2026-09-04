/**
 * @vitest-environment node
 */
import {
  dbChainMock,
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFetchGo, mockGetMothershipBaseURL } = vi.hoisted(() => ({
  mockFetchGo: vi.fn(),
  mockGetMothershipBaseURL: vi.fn(),
}))

vi.mock('@sim/db', () => ({ ...dbChainMock, ...schemaMock }))
vi.mock('@/lib/mothership/request/go/fetch', () => ({ fetchGo: mockFetchGo }))
vi.mock('@/lib/mothership/request/headers', () => ({
  mothershipRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
}))
vi.mock('@/lib/mothership/server/agent-url', () => ({
  getMothershipBaseURL: mockGetMothershipBaseURL,
}))

import { notifyWorkflowRunTasks, subscribeTaskToExecution } from './subscriptions'

const SUBSCRIPTION = {
  id: 'sub-1',
  taskId: '11111111-1111-4111-8111-111111111111',
  executionId: 'exec-1',
  chatId: 'chat-1',
  workspaceId: 'ws-1',
  userId: 'user-1',
  createdAt: new Date(),
}

describe('copilot task subscriptions', () => {
  beforeEach(() => {
    resetDbChainMock()
    vi.clearAllMocks()
    mockGetMothershipBaseURL.mockResolvedValue('http://worker.test')
  })

  it('refuses a subscription for a chat outside the workspace', async () => {
    queueTableRows(schemaMock.copilotChats, [{ userId: 'user-1', workspaceId: 'other-ws' }])
    const outcome = await subscribeTaskToExecution({
      taskId: SUBSCRIPTION.taskId,
      executionId: 'exec-1',
      chatId: 'chat-1',
      workspaceId: 'ws-1',
    })
    expect(outcome).toEqual({ ok: false, status: 404, error: 'Chat not found in this workspace' })
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  it('records the subscription under the chat owner', async () => {
    queueTableRows(schemaMock.copilotChats, [{ userId: 'user-1', workspaceId: 'ws-1' }])
    const outcome = await subscribeTaskToExecution({
      taskId: SUBSCRIPTION.taskId,
      executionId: 'exec-1',
      chatId: 'chat-1',
      workspaceId: 'ws-1',
    })
    expect(outcome).toEqual({ ok: true })
    expect(dbChainMockFns.insert).toHaveBeenCalledWith(schemaMock.copilotTaskSubscriptions)
    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', executionId: 'exec-1' })
    )
  })

  it('posts a failed run to the worker with the error as output and deletes the row', async () => {
    queueTableRows(schemaMock.copilotTaskSubscriptions, [SUBSCRIPTION])
    queueTableRows(schemaMock.workflow, [{ workspaceId: 'ws-1', name: 'Nightly sync' }])
    mockFetchGo.mockResolvedValue({ ok: true, status: 200 })
    await notifyWorkflowRunTasks({
      executionId: 'exec-1',
      workflowId: 'wf-1',
      status: 'failed',
      error: 'Slack channel not found',
    })
    expect(mockFetchGo).toHaveBeenCalledTimes(1)
    const [url, init] = mockFetchGo.mock.calls[0]
    expect(url).toBe('http://worker.test/api/tasks/complete')
    const body = JSON.parse(init.body as string)
    expect(body.taskId).toBe(SUBSCRIPTION.taskId)
    expect(body.status).toBe('failed')
    expect(body.summary).toContain('Nightly sync')
    expect(body.summary).toContain('Slack channel not found')
    expect(body.output).toBe('Slack channel not found')
    expect(dbChainMockFns.delete).toHaveBeenCalledWith(schemaMock.copilotTaskSubscriptions)
  })

  it('keeps the row when the worker cannot be reached', async () => {
    queueTableRows(schemaMock.copilotTaskSubscriptions, [SUBSCRIPTION])
    queueTableRows(schemaMock.workflow, [{ workspaceId: 'ws-1', name: 'Nightly sync' }])
    mockFetchGo.mockRejectedValue(new Error('ECONNREFUSED'))
    await notifyWorkflowRunTasks({ executionId: 'exec-1', workflowId: 'wf-1', status: 'completed' })
    expect(dbChainMockFns.delete).not.toHaveBeenCalled()
  })

  it('drops a subscription whose workspace is not the run workflow workspace', async () => {
    queueTableRows(schemaMock.copilotTaskSubscriptions, [SUBSCRIPTION])
    queueTableRows(schemaMock.workflow, [{ workspaceId: 'someone-else', name: 'x' }])
    await notifyWorkflowRunTasks({ executionId: 'exec-1', workflowId: 'wf-1', status: 'completed' })
    expect(mockFetchGo).not.toHaveBeenCalled()
    expect(dbChainMockFns.delete).toHaveBeenCalledWith(schemaMock.copilotTaskSubscriptions)
  })
})

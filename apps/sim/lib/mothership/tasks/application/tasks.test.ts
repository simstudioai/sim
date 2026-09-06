/** @vitest-environment node */
import { dbChainMock, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  workspace: vi.fn(),
  banned: vi.fn(),
  execution: vi.fn(),
  status: vi.fn(),
  acquire: vi.fn(),
  internalAuth: vi.fn(),
  after: vi.fn(),
  worker: vi.fn(),
}))
vi.mock('@/lib/mothership/request/http', () => ({ checkInternalApiKey: mocks.internalAuth }))
vi.mock('next/server', async (original) => ({
  ...(await original<typeof import('next/server')>()),
  after: mocks.after,
}))
vi.mock('@/lib/mothership/request/go/fetch', () => ({ fetchGo: mocks.worker }))
vi.mock('@/lib/mothership/server/agent-url', () => ({
  getMothershipBaseURL: async () => 'http://worker',
  getMothershipSourceEnvHeaders: () => ({}),
}))
vi.mock('@sim/db', () => ({ ...dbChainMock, ...schemaMock }))
vi.mock('@/lib/auth/ban', () => ({ getActivelyBannedUserIds: mocks.banned }))
vi.mock('@/lib/core/application/workspace-authorization', async (original) => ({
  ...(await original<typeof import('@/lib/core/application/workspace-authorization')>()),
  authorizeWorkspaceOperation: mocks.authorize,
}))
vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  resolveActiveWorkspaceApplicationContext: mocks.workspace,
}))
vi.mock('@/lib/workflows/application/context', () => ({
  resolveActiveWorkflowRunApplicationContext: mocks.execution,
}))
vi.mock('@/lib/workflows/executor/execution-status', () => ({
  getWorkflowExecutionStatus: mocks.status,
}))
vi.mock('@/lib/mothership/request/session/abort', () => ({
  acquirePendingChatStream: mocks.acquire,
}))

import { NextRequest } from 'next/server'
import { runEmbeddedCli } from 'sim/embed'
import { v2GetWorkflowRunContract } from '@/lib/api/contracts/v2/workflows'
import { createTrustedCopilotPrincipal } from '@/lib/mothership/auth/application-delegation'
import { WorkflowWatchStatus } from '@/lib/mothership/generated/tasks'
import { POST as watchRoute } from '@/app/api/mothership/tasks/workflow-status/route'
import { POST as wakeRoute } from '@/app/api/mothership/wake/route'
import { TASK_DELEGATION_AUDIENCE } from './context'
import { prepareTaskWake } from './prepare-wake'
import { readTaskStatus } from './read-status'
import { readWatchedWorkflowStatus } from './read-workflow-status'

const principal = createTrustedCopilotPrincipal(
  { userId: 'u', workspaceId: 'w', delegationId: 'test' },
  { audience: TASK_DELEGATION_AUDIENCE, ttlMs: 60_000 }
)
const input = {
  taskId: 'task',
  runId: 'run',
  chatId: 'chat',
  userId: 'u',
  workspaceId: 'w',
  message: 'notification',
  status: 'completed',
  summary: 'done',
} as const

beforeEach(() => {
  resetDbChainMock()
  vi.clearAllMocks()
  queueTableRows(schemaMock.copilotChats, [{ userId: 'u', workspaceId: 'w' }])
  mocks.banned.mockResolvedValue([])
  mocks.workspace.mockResolvedValue({
    workspaceId: 'w',
    workspaceOrganizationId: null,
    allowPersonalApiKeys: false,
  })
  mocks.authorize.mockResolvedValue(undefined)
  mocks.execution.mockResolvedValue({ workflowId: 'wf', runId: 'exec', workflow: { name: 'Flow' } })
  mocks.status.mockResolvedValue({ status: 'completed', error: null })
  mocks.acquire.mockResolvedValue(true)
  mocks.internalAuth.mockReturnValue({ success: true })
})

describe('durable workflow watches', () => {
  it('observes completion before the watch was registered', async () => {
    expect(
      await readWatchedWorkflowStatus.execute({
        principal,
        input: { chatId: 'chat', executionId: 'exec' },
      })
    ).toEqual({
      workflowId: 'wf',
      status: 'completed',
      summary: 'Workflow run exec of "Flow" completed',
    })
    expect(mocks.execution).toHaveBeenCalledWith({ runId: 'exec', assertedWorkspaceId: 'w' })
  })
  it('returns the canonical workflow identity needed to read the completed run', async () => {
    const status = await readWatchedWorkflowStatus.execute({
      principal,
      input: { chatId: 'chat', executionId: 'exec' },
    })
    expect(status).toMatchObject({ workflowId: 'wf', status: 'completed' })
    expect(mocks.status).toHaveBeenCalledExactlyOnceWith({
      workflowId: 'wf',
      executionId: 'exec',
      includeOutput: false,
      selectedOutputs: [],
    })
  })
  it.each(['pending', 'paused', 'resuming', 'queued', 'running'])(
    'does not complete a %s execution',
    async (status) => {
      mocks.status.mockResolvedValue({ status })
      expect(
        (
          await readWatchedWorkflowStatus.execute({
            principal,
            input: { chatId: 'chat', executionId: 'exec' },
          })
        ).status
      ).toBe('pending')
    }
  )
  it('propagates outages so the durable watch can retry', async () => {
    mocks.status.mockRejectedValue(new Error('database unavailable'))
    await expect(
      readWatchedWorkflowStatus.execute({
        principal,
        input: { chatId: 'chat', executionId: 'exec' },
      })
    ).rejects.toThrow('database unavailable')
  })
  it('rejects unauthorized access before reading the execution', async () => {
    mocks.authorize.mockRejectedValue(new Error('access revoked'))
    await expect(
      readWatchedWorkflowStatus.execute({
        principal,
        input: { chatId: 'chat', executionId: 'exec' },
      })
    ).rejects.toThrow('access revoked')
    expect(mocks.execution).not.toHaveBeenCalled()
  })
  it('rejects disallowed principals before loading protected data', async () => {
    await expect(
      readWatchedWorkflowStatus.execute({
        principal: { kind: 'session', userId: 'u', sessionId: 's' },
        input: { chatId: 'chat', executionId: 'exec' },
      })
    ).rejects.toThrow()
    expect(mocks.workspace).not.toHaveBeenCalled()
  })
  it('conceals a different chat owner', async () => {
    const other = createTrustedCopilotPrincipal(
      { userId: 'other', workspaceId: 'w', delegationId: 'test' },
      { audience: TASK_DELEGATION_AUDIENCE, ttlMs: 60_000 }
    )
    await expect(
      readWatchedWorkflowStatus.execute({
        principal: other,
        input: { chatId: 'chat', executionId: 'exec' },
      })
    ).rejects.toThrow('Chat not found')
  })
})

describe('wake admission', () => {
  it('refuses a busy chat before accepting the wake', async () => {
    mocks.acquire.mockResolvedValue(false)
    await expect(prepareTaskWake.execute({ principal, input })).rejects.toMatchObject({
      code: 'conflict',
    })
  })
  it('reserves the exact retry identity before acknowledging', async () => {
    expect(await prepareTaskWake.execute({ principal, input })).toEqual({ accepted: true })
    expect(mocks.acquire).toHaveBeenCalledWith('chat', 'run')
  })
  it('rejects forged body identity before reserving a turn', async () => {
    await expect(
      prepareTaskWake.execute({ principal, input: { ...input, userId: 'other' } })
    ).rejects.toThrow('Chat not found')
    expect(mocks.acquire).not.toHaveBeenCalled()
  })
})

const CHAT_ID = '11111111-1111-4111-8111-111111111111'
const TASK_ID = '22222222-2222-4222-8222-222222222222'
const RUN_ID = '33333333-3333-4333-8333-333333333333'
function request(path: string, body: string): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    body,
    headers: {
      'content-type': 'application/json',
      'x-mothership-user-id': 'u',
      'x-mothership-workspace-id': 'w',
    },
  })
}
const routeContext = { params: Promise.resolve({}) }

describe('worker HTTP contracts', () => {
  it('authenticates before reading an invalid body', async () => {
    mocks.internalAuth.mockReturnValue({ success: false })
    const response = await watchRoute(
      request('/api/mothership/tasks/workflow-status', '{'),
      routeContext
    )
    expect(response.status).toBe(401)
    expect(mocks.execution).not.toHaveBeenCalled()
  })
  it('serves the canonical terminal status through the real route contract', async () => {
    const response = await watchRoute(
      request(
        '/api/mothership/tasks/workflow-status',
        JSON.stringify({ chatId: CHAT_ID, executionId: 'exec' })
      ),
      routeContext
    )
    expect(response.status).toBe(200)
    const watched = WorkflowWatchStatus.parse(await response.json())
    expect(watched).toMatchObject({ workflowId: 'wf', status: 'completed' })
    const resultBody = v2GetWorkflowRunContract.response.schema.parse({
      data: {
        runId: 'exec',
        workflowId: 'wf',
        status: 'completed',
        trigger: null,
        startedAt: '2026-09-06T00:00:00.000Z',
        endedAt: '2026-09-06T00:00:01.000Z',
        durationMs: 1000,
        paused: null,
        cost: null,
        error: null,
        output: { report: 'completed result' },
        blockOutputs: null,
        files: [],
      },
    })
    const transport = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const read = new Request(url, init)
      expect(read.method).toBe('GET')
      expect(new URL(read.url).pathname).toBe('/api/v2/workflows/wf/runs/exec')
      expect(new URL(read.url).searchParams.get('includeOutput')).toBe('true')
      return Response.json(resultBody)
    })
    const recovered = await runEmbeddedCli(
      ['workflows', 'runs', 'get', 'exec', '--workflow', watched.workflowId, '--include-output'],
      { endpoint: 'https://sim.test', apiKey: 'test', workspaceId: 'w', transport }
    )
    expect(recovered.exitCode, recovered.stderr).toBe(0)
    expect(JSON.parse(recovered.stdout)).toEqual(resultBody.data)
    expect(transport).toHaveBeenCalledTimes(1)
  })
  it('returns retryable conflict without scheduling a busy wake', async () => {
    mocks.acquire.mockResolvedValue(false)
    const response = await wakeRoute(
      request(
        '/api/mothership/wake',
        JSON.stringify({ ...input, chatId: CHAT_ID, taskId: TASK_ID, runId: RUN_ID })
      ),
      routeContext
    )
    expect(response.status).toBe(409)
    expect(mocks.after).not.toHaveBeenCalled()
  })
  it('returns accepted only after reserving the wake', async () => {
    const response = await wakeRoute(
      request(
        '/api/mothership/wake',
        JSON.stringify({ ...input, chatId: CHAT_ID, taskId: TASK_ID, runId: RUN_ID })
      ),
      routeContext
    )
    expect(response.status).toBe(202)
    expect(await response.json()).toMatchObject({ accepted: true })
    expect(mocks.acquire).toHaveBeenCalledWith(CHAT_ID, RUN_ID)
    expect(mocks.after).toHaveBeenCalledTimes(1)
  })
})

describe('task status access', () => {
  function statusResponse(): Response {
    return new Response(
      JSON.stringify({
        taskId: TASK_ID,
        chatId: CHAT_ID,
        status: 'stopped',
        summary: 'Stopped by the agent',
      })
    )
  }
  it('projects the authoritative task status after checking its canonical chat', async () => {
    mocks.worker.mockResolvedValue(statusResponse())
    const result = await readTaskStatus.execute({
      principal: { kind: 'session', userId: 'u', sessionId: 's' },
      input: { taskId: TASK_ID },
    })
    expect(result).toEqual({ taskId: TASK_ID, status: 'stopped', summary: 'Stopped by the agent' })
    expect(mocks.authorize).toHaveBeenCalled()
  })
  it('does not expose a task to another chat owner', async () => {
    mocks.worker.mockResolvedValue(statusResponse())
    await expect(
      readTaskStatus.execute({
        principal: { kind: 'session', userId: 'other', sessionId: 's' },
        input: { taskId: TASK_ID },
      })
    ).rejects.toThrow('Chat not found')
    expect(mocks.authorize).not.toHaveBeenCalled()
  })
  it('preserves a worker outage as an error instead of inventing a task status', async () => {
    mocks.worker.mockResolvedValue(new Response('{}', { status: 503 }))
    await expect(
      readTaskStatus.execute({
        principal: { kind: 'session', userId: 'u', sessionId: 's' },
        input: { taskId: TASK_ID },
      })
    ).rejects.toThrow('Task service is unavailable')
  })
})

/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = vi.hoisted(() => ({
  read: vi.fn(),
  status: vi.fn(),
  prepare: vi.fn(),
  wake: vi.fn(),
}))
vi.mock('@/lib/mothership/request/application/read-control', () => ({
  RUN_CONTROL_AUDIENCE: 'control',
  readRunControl: { execute: handlers.read },
}))
vi.mock('@/lib/mothership/tasks/application/read-workflow-status', () => ({
  readWatchedWorkflowStatus: { execute: handlers.status },
}))
vi.mock('@/lib/mothership/tasks/application/prepare-wake', () => ({
  prepareTaskWake: { execute: handlers.prepare },
}))
vi.mock('@/lib/mothership/tasks/application/context', () => ({ TASK_DELEGATION_AUDIENCE: 'tasks' }))
vi.mock('@/lib/mothership/tasks/wake', () => ({ runWakeTurn: handlers.wake }))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import type {
  SimControlOperation,
  SimControlRequest,
} from '@/lib/mothership/generated/sim-transport'
import { executeSimControl } from '@/lib/mothership/transport/control'

const scope = { userId: 'user', workspaceId: 'workspace', chatId: 'chat' }
function request(operation: SimControlOperation): SimControlRequest {
  return { id: 'request', scope, operation, expiresAt: Date.now() + 5000 }
}

describe('outbound control delivery uses the existing authorized operations', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    handlers.read.mockResolvedValue({ stopped: true })
    handlers.status.mockResolvedValue({
      status: 'pending',
      workflowId: 'workflow',
      summary: 'pending',
    })
    handlers.prepare.mockResolvedValue({ accepted: true })
    handlers.wake.mockResolvedValue(undefined)
  })

  it('reconciles Stop with a chat-scoped principal and the exact stream ID', async () => {
    const operation: SimControlOperation = {
      kind: 'run_control',
      input: { chatId: 'chat', streamId: 'stream' },
    }
    expect(await executeSimControl(request(operation))).toEqual({
      status: 200,
      body: '{"stopped":true}',
    })
    expect(handlers.read).toHaveBeenCalledWith({
      input: operation.input,
      principal: expect.objectContaining({
        subjectUserId: 'user',
        workspaceId: 'workspace',
        audience: 'control',
        resourceScope: { chatId: 'chat' },
      }),
    })
  })

  it('preserves workflow status and permission failure responses', async () => {
    const operation: SimControlOperation = {
      kind: 'workflow_status',
      input: { chatId: 'chat', executionId: 'execution' },
    }
    const response = await executeSimControl(request(operation))
    expect(JSON.parse(response.body)).toMatchObject({ status: 'pending', workflowId: 'workflow' })
    handlers.status.mockRejectedValue(new OrchestrationError('forbidden', 'No access'))
    expect(await executeSimControl(request(operation))).toEqual({
      status: 403,
      body: '{"error":"No access"}',
    })
  })

  it('starts a wake only after the existing admission operation accepts it', async () => {
    const operation: SimControlOperation = {
      kind: 'wake',
      input: {
        ...scope,
        taskId: 'task',
        runId: 'run',
        status: 'completed',
        summary: 'done',
        message: 'follow up',
      },
    }
    handlers.prepare.mockRejectedValueOnce(new OrchestrationError('conflict', 'Busy'))
    expect((await executeSimControl(request(operation))).status).toBe(409)
    expect(handlers.wake).not.toHaveBeenCalled()
    expect((await executeSimControl(request(operation))).status).toBe(200)
    expect(handlers.wake).toHaveBeenCalledExactlyOnceWith(operation.input)
  })

  it('rejects expired and mismatched chat requests before calling an operation', async () => {
    const operation: SimControlOperation = {
      kind: 'run_control',
      input: { chatId: 'chat', streamId: 'stream' },
    }
    expect((await executeSimControl({ ...request(operation), expiresAt: 1 })).status).toBe(410)
    expect(
      (await executeSimControl({ ...request(operation), scope: { ...scope, chatId: 'another' } }))
        .status
    ).toBe(403)
    expect(handlers.read).not.toHaveBeenCalled()
  })

  it('keeps unclassified database errors out of the wire response', async () => {
    handlers.read.mockRejectedValue(new Error('private database query details'))
    const result = await executeSimControl(
      request({ kind: 'run_control', input: { chatId: 'chat', streamId: 'stream' } })
    )
    expect(result).toEqual({ status: 500, body: '{"error":"Internal server error"}' })
  })
})

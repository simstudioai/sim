/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { presentDispatchOrJobStatus } from '@/lib/core/workspace-dispatch/status'

describe('workspace dispatch status presentation', () => {
  it('presents waiting dispatch jobs with queue metadata', () => {
    const result = presentDispatchOrJobStatus(
      {
        id: 'dispatch-1',
        workspaceId: 'workspace-1',
        lane: 'runtime',
        queueName: 'workflow-execution',
        bullmqJobName: 'workflow-execution',
        bullmqPayload: {},
        metadata: { workflowId: 'workflow-1' },
        priority: 10,
        status: 'waiting',
        createdAt: 1000,
      },
      null
    )

    expect(result).toEqual({
      status: 'waiting',
      metadata: {
        createdAt: new Date(1000),
        admittedAt: undefined,
        startedAt: undefined,
        completedAt: undefined,
        queueName: 'workflow-execution',
        lane: 'runtime',
        workspaceId: 'workspace-1',
      },
      estimatedDuration: 300000,
    })
  })

  it('presents admitting dispatch jobs distinctly', () => {
    const result = presentDispatchOrJobStatus(
      {
        id: 'dispatch-1a',
        workspaceId: 'workspace-1',
        lane: 'runtime',
        queueName: 'workflow-execution',
        bullmqJobName: 'workflow-execution',
        bullmqPayload: {},
        metadata: { workflowId: 'workflow-1' },
        priority: 10,
        status: 'admitting',
        createdAt: 1000,
      },
      null
    )

    expect(result.status).toBe('admitting')
    expect(result.estimatedDuration).toBe(300000)
  })

  it('presents completed dispatch jobs with output and duration', () => {
    const result = presentDispatchOrJobStatus(
      {
        id: 'dispatch-2',
        workspaceId: 'workspace-1',
        lane: 'interactive',
        queueName: 'workflow-execution',
        bullmqJobName: 'direct-workflow-execution',
        bullmqPayload: {},
        metadata: { workflowId: 'workflow-1' },
        priority: 1,
        status: 'completed',
        createdAt: 1000,
        admittedAt: 1500,
        startedAt: 2000,
        completedAt: 7000,
        output: { success: true },
      },
      null
    )

    expect(result.status).toBe('completed')
    expect(result.output).toEqual({ success: true })
    expect(result.metadata.duration).toBe(5000)
  })

  it('falls back to legacy job status when no dispatch record exists', () => {
    const result = presentDispatchOrJobStatus(null, {
      id: 'job-1',
      type: 'workflow-execution',
      payload: {},
      status: 'pending',
      createdAt: new Date(1000),
      attempts: 0,
      maxAttempts: 3,
      metadata: {},
    })

    expect(result.status).toBe('queued')
    expect(result.estimatedDuration).toBe(300000)
  })
})

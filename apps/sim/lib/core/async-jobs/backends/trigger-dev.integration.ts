import { db } from '@sim/db'
import { idempotencyKey } from '@sim/db/schema'
import { asyncJobsRegionMock } from '@sim/testing/mocks/async-jobs-region.mock'
import { triggerSdkMock, triggerSdkMockFns } from '@sim/testing/mocks/trigger-sdk.mock'
import { generateId } from '@sim/utils/id'
import { inArray } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { TriggerDevJobQueue } from '@/lib/core/async-jobs/backends/trigger-dev'

vi.mock('@trigger.dev/sdk', () => triggerSdkMock)
vi.mock('@/lib/core/async-jobs/region', () => asyncJobsRegionMock)

const receipts: string[] = []
const runs = new Map<
  string,
  { id: string; taskIdentifier: string; status: string; payload: unknown; createdAt: Date }
>()

beforeEach(() => {
  triggerSdkMockFns.mockRunsList.mockReset()
  runs.clear()
  triggerSdkMockFns.mockTasksTrigger.mockImplementation(async (type, payload) => {
    const id = `run_${generateId()}`
    runs.set(id, { id, taskIdentifier: type, status: 'QUEUED', payload, createdAt: new Date() })
    return { id }
  })
  triggerSdkMockFns.mockRunsRetrieve.mockImplementation(async (id) => {
    const run = runs.get(id)
    if (!run) throw new Error('Run not found')
    return run
  })
  triggerSdkMockFns.mockRunsCancel.mockImplementation(async (id) => {
    const run = runs.get(id)
    if (!run) throw new Error('Run not found')
    run.status = 'CANCELED'
    return run
  })
})

afterAll(async () => {
  if (receipts.length) await db.delete(idempotencyKey).where(inArray(idempotencyKey.key, receipts))
})

async function enqueue() {
  const executionId = generateId()
  const workflowId = generateId()
  const rootJobId = `workflow-execution:${executionId}`
  receipts.push(`trigger-job:${rootJobId}`)
  const id = await new TriggerDevJobQueue().enqueue(
    'workflow-execution',
    { executionId, workflowId },
    { jobId: rootJobId }
  )
  return { id, binding: { workflowId, executionId, rootJobId } }
}

describe('accepted Trigger runs before tag indexing', () => {
  it('persists a receipt and lets another queue instance read the accepted run', async () => {
    const { id, binding } = await enqueue()
    const reader = new TriggerDevJobQueue()
    expect(await reader.getJob(binding.rootJobId)).toMatchObject({
      id,
      status: 'pending',
      metadata: { workflowId: binding.workflowId },
    })
    const stored = await db
      .select()
      .from(idempotencyKey)
      .where(inArray(idempotencyKey.key, receipts))
    expect(
      stored.some(
        (row) =>
          row.key === `trigger-job:${binding.rootJobId}` &&
          (row.result as { runId: string }).runId === id
      )
    ).toBe(true)
  })

  it('cancels an accepted run while every tag search is still empty', async () => {
    const { id, binding } = await enqueue()
    expect(await new TriggerDevJobQueue().cancelByExecution(binding, 'standalone')).toBe(1)
    expect(runs.get(id)?.status).toBe('CANCELED')
  })

  it('keeps a retry discoverable and cancels a run only once when its tags catch up', async () => {
    const { id, binding } = await enqueue()
    triggerSdkMockFns.mockTasksTrigger.mockResolvedValueOnce({ id })
    await new TriggerDevJobQueue().enqueue(
      'workflow-execution',
      {
        workflowId: binding.workflowId,
        executionId: binding.executionId,
      },
      { jobId: binding.rootJobId }
    )
    triggerSdkMockFns.mockRunsList.mockImplementation(() => ({
      async *[Symbol.asyncIterator]() {
        yield {
          id,
          taskIdentifier: 'workflow-execution',
          tags: [`workflowId:${binding.workflowId}`, `executionId:${binding.executionId}`],
        }
      },
    }))
    const queue = new TriggerDevJobQueue()
    expect(await queue.getJob(binding.rootJobId)).toMatchObject({ id })
    expect(await queue.cancelByExecution(binding, 'standalone')).toBe(1)
    expect(runs.get(id)?.status).toBe('CANCELED')
  })

  it('does not cancel a receipt belonging to another workflow or cancellation scope', async () => {
    const { id, binding } = await enqueue()
    const queue = new TriggerDevJobQueue()
    expect(
      await queue.cancelByExecution({ ...binding, workflowId: generateId() }, 'standalone')
    ).toBe(0)
    expect(
      await queue.cancelByExecution({ ...binding, executionId: generateId() }, 'standalone')
    ).toBe(0)
    expect(await queue.cancelByExecution(binding, 'resume')).toBe(0)
    expect(runs.get(id)?.status).toBe('QUEUED')
  })

  it('does not report a completed receipt as a successful cancellation', async () => {
    const { id, binding } = await enqueue()
    runs.get(id)!.status = 'COMPLETED'
    expect(await new TriggerDevJobQueue().cancelByExecution(binding, 'standalone')).toBe(0)
    expect(runs.get(id)?.status).toBe('COMPLETED')
  })
})

/**
 * @vitest-environment node
 */
import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OutboxEventContext } from '@/lib/core/outbox/service'
import type { WorkspaceOperationReport } from '@/lib/workspaces/operations/receipts'
import { forkContentOutboxHandlers } from '@/ee/workspace-forking/application/content-outbox'
import type {
  ForkContentCopyPayload,
  runForkContentCopy,
} from '@/ee/workspace-forking/lib/copy/content-copy-runner'
import {
  ForkCopyCheckpointError,
  ForkCopyContinuation,
  type ForkCopyControl,
  type ForkCopyProgress,
} from '@/ee/workspace-forking/lib/copy/progress'

const { mockRunForkContentCopy, receiptTable } = vi.hoisted(() => ({
  mockRunForkContentCopy: vi.fn<typeof runForkContentCopy>(),
  receiptTable: {
    id: 'workspaceOperationReceipt.id',
    workspaceId: 'workspaceOperationReceipt.workspaceId',
    report: 'workspaceOperationReceipt.report',
  },
}))

vi.mock('@sim/db/schema', () => ({ ...schemaMock, workspaceOperationReceipt: receiptTable }))
vi.mock('@/ee/workspace-forking/lib/copy/content-copy-runner', () => ({
  runForkContentCopy: mockRunForkContentCopy,
}))

const copy: ForkContentCopyPayload = {
  contentPlan: {
    sourceWorkspaceId: 'source',
    childWorkspaceId: 'target',
    userId: 'user',
    tables: [],
    knowledgeBases: [],
    skills: [],
    documents: [],
  },
  blobTasks: [],
}
const payload = { operationId: 'operation', workspaceId: 'target', copy }
const handler = forkContentOutboxHandlers['workspace.fork.content.copy']

function context(overrides: Partial<OutboxEventContext> = {}): OutboxEventContext {
  return {
    eventId: 'copy-event',
    eventType: 'workspace.fork.content.copy',
    attempts: 0,
    maxAttempts: 10,
    signal: new AbortController().signal,
    checkpointPayload: vi.fn(async () => {}),
    ...overrides,
  }
}

function report(overrides: Partial<WorkspaceOperationReport> = {}): WorkspaceOperationReport {
  return {
    operationId: 'operation',
    requestId: 'request',
    workspaceId: 'target',
    kind: 'workspace_fork',
    applied: true,
    status: 'processing',
    resourceIds: ['target'],
    issues: [],
    copyProgress: { status: 'pending', copied: 0, failed: 0 },
    ...overrides,
  }
}

function copyControl(options: Parameters<typeof runForkContentCopy>[1]): ForkCopyControl & {
  progress: ForkCopyProgress
  checkpoint: (progress: ForkCopyProgress) => Promise<void>
} {
  if (!options?.control?.progress || !options.control.checkpoint) throw new Error('Missing control')
  return {
    ...options.control,
    progress: options.control.progress,
    checkpoint: options.control.checkpoint,
  }
}

describe('fork content outbox checkpoints', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockRunForkContentCopy.mockReset()
  })

  it('writes concurrent progress snapshots in order without later mutations changing earlier writes', async () => {
    queueTableRows(receiptTable, [{ report: report() }])
    let releaseFirst = () => {}
    const firstWrite = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const checkpoint = vi.fn(async () => {})
    checkpoint.mockImplementationOnce(() => firstWrite)
    mockRunForkContentCopy.mockImplementation(async (_, options) => {
      const control = copyControl(options)
      control.progress.tables.first = { afterId: '8', copied: 8, lastOrderKey: null }
      const first = control.checkpoint(control.progress)
      control.progress.tables.second = { afterId: '4', copied: 4, lastOrderKey: null }
      const second = control.checkpoint(control.progress)
      await Promise.resolve()
      expect(checkpoint).toHaveBeenCalledTimes(1)
      expect(checkpoint).toHaveBeenNthCalledWith(1, {
        progress: {
          completed: [],
          tables: { first: { afterId: '8', copied: 8, lastOrderKey: null } },
          embeddings: {},
        },
      })
      releaseFirst()
      await Promise.all([first, second])
      expect(checkpoint).toHaveBeenNthCalledWith(2, { progress: control.progress })
    })
    await handler(payload, context({ checkpointPayload: checkpoint }))
  })

  it('rejects every queued checkpoint after lease loss and prevents stale writes', async () => {
    queueTableRows(receiptTable, [{ report: report() }])
    const checkpoint = vi.fn(async () => {
      throw new Error('lease no longer held')
    })
    mockRunForkContentCopy.mockImplementation(async (_, options) => {
      const control = copyControl(options)
      const outcomes = await Promise.allSettled([
        control.checkpoint(control.progress),
        control.checkpoint(control.progress),
      ])
      for (const outcome of outcomes) {
        expect(outcome.status).toBe('rejected')
        if (outcome.status === 'rejected')
          expect(outcome.reason).toBeInstanceOf(ForkCopyCheckpointError)
      }
      if (outcomes[0].status === 'rejected') throw outcomes[0].reason
    })
    await expect(
      handler(payload, context({ checkpointPayload: checkpoint }))
    ).rejects.toBeInstanceOf(ForkCopyCheckpointError)
    expect(checkpoint).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('returns a continuation without consuming a retry or recording completion', async () => {
    queueTableRows(receiptTable, [{ report: report() }])
    mockRunForkContentCopy.mockRejectedValueOnce(new ForkCopyContinuation('resume from cursor'))
    expect(await handler(payload, context())).toMatchObject({
      outcome: 'deferred',
      consumeAttempt: false,
      reason: 'resume from cursor',
    })
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('retains a committed copy failure while remaining processing for admitted effects', async () => {
    const current = report({ effectEventIds: ['deployment-effect'] })
    queueTableRows(receiptTable, [{ report: current }])
    queueTableRows(receiptTable, [{ report: current }])
    mockRunForkContentCopy.mockImplementation(async (_, options) => {
      await options?.onComplete?.({ copied: 2, failed: 1 })
    })
    await handler(payload, context())
    expect(dbChainMockFns.set).toHaveBeenCalledWith({
      report: expect.objectContaining({
        applied: true,
        status: 'processing',
        copyProgress: { status: 'failed', copied: 2, failed: 1 },
        issues: [expect.objectContaining({ code: 'resource_copy_failed' })],
      }),
      updatedAt: expect.any(Date),
    })
  })

  it('does not overwrite the receipt when the completing worker loses its lease', async () => {
    queueTableRows(receiptTable, [{ report: report() }])
    const controller = new AbortController()
    mockRunForkContentCopy.mockImplementation(async (_, options) => {
      controller.abort(new Error('lease expired'))
      await options?.onComplete?.({ copied: 1, failed: 0 })
    })
    await expect(handler(payload, context({ signal: controller.signal }))).rejects.toThrow(
      'lease expired'
    )
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
  })

  it('does not rerun an already completed receipt', async () => {
    queueTableRows(receiptTable, [
      { report: report({ copyProgress: { status: 'completed', copied: 1, failed: 0 } }) },
    ])
    await handler(payload, context())
    expect(mockRunForkContentCopy).not.toHaveBeenCalled()
  })
})

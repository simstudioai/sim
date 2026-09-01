/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { RowExecutionMetadata, TableRow } from '@/lib/table'
import type { TableEvent } from '@/lib/table/events'
import { applyCellEventToRow } from '@/app/workspace/[workspaceId]/tables/[tableId]/hooks/use-table-event-stream'

const TABLE_ID = 'table-1'
const ROW_ID = 'row-1'
const GROUP_ID = 'group-1'

function createRow(
  executionId: string | null,
  status: RowExecutionMetadata['status'],
  overrides: Partial<RowExecutionMetadata> = {}
): TableRow {
  return {
    id: ROW_ID,
    data: { result: 'current' },
    position: 0,
    executions: {
      [GROUP_ID]: {
        status,
        executionId,
        jobId: null,
        workflowId: 'workflow-1',
        error: null,
        ...overrides,
      },
    },
  }
}

function createCellEvent(
  status: Extract<TableEvent, { kind: 'cell' }>['status'],
  executionId: string | null,
  overrides: Partial<Extract<TableEvent, { kind: 'cell' }>> = {}
): Extract<TableEvent, { kind: 'cell' }> {
  return {
    kind: 'cell',
    tableId: TABLE_ID,
    rowId: ROW_ID,
    groupId: GROUP_ID,
    status,
    executionId,
    jobId: null,
    error: null,
    ...overrides,
  }
}

describe('applyCellEventToRow', () => {
  it.each(['completed', 'error', 'cancelled'] as const)(
    'ignores a stale %s event from an older execution',
    (status) => {
      const row = createRow('execution-new', 'running')
      const event = createCellEvent(status, 'execution-old', {
        outputs: { result: 'stale' },
        error: status === 'error' ? 'Old failure' : null,
      })

      expect(applyCellEventToRow(row, event)).toBeNull()
      expect(row.data.result).toBe('current')
      expect(row.executions?.[GROUP_ID]?.executionId).toBe('execution-new')
    }
  )

  it.each(['pending', 'queued', 'running'] as const)(
    'ignores a stale %s event from an older execution',
    (status) => {
      const row = createRow('execution-new', 'running')
      const event = createCellEvent(status, 'execution-old', {
        outputs: { result: 'stale' },
      })

      expect(applyCellEventToRow(row, event)).toBeNull()
      expect(row.data.result).toBe('current')
      expect(row.executions?.[GROUP_ID]?.executionId).toBe('execution-new')
    }
  )

  it('ignores an old id-less pre-stamp once an identified attempt is active', () => {
    const row = createRow('execution-new', 'running')

    expect(applyCellEventToRow(row, createCellEvent('pending', null))).toBeNull()
  })

  it.each(['queued', 'running'] as const)(
    'lets %s claim an id-less pending pre-stamp',
    (status) => {
      const row = createRow(null, 'pending')

      expect(
        applyCellEventToRow(row, createCellEvent(status, 'execution-new', { jobId: 'job-new' }))
      ).toMatchObject({
        executions: {
          [GROUP_ID]: {
            status,
            executionId: 'execution-new',
            jobId: 'job-new',
            workflowId: 'workflow-1',
          },
        },
      })
    }
  )

  it('ignores a delayed id-less pre-stamp after a terminal state', () => {
    const row = createRow('execution-old', 'completed')

    expect(applyCellEventToRow(row, createCellEvent('pending', null))).toBeNull()
  })

  it('seeds an id-less pending pre-stamp when the group has no cached attempt', () => {
    const row: TableRow = {
      id: ROW_ID,
      data: { result: 'current' },
      position: 0,
      executions: {},
    }

    expect(applyCellEventToRow(row, createCellEvent('pending', null))).toMatchObject({
      executions: {
        [GROUP_ID]: {
          status: 'pending',
          executionId: null,
        },
      },
    })
  })

  it('applies the server pre-stamp over the optimistic pending state', () => {
    const row = createRow('execution-old', 'pending', { jobId: null })

    expect(applyCellEventToRow(row, createCellEvent('pending', null))).toMatchObject({
      executions: {
        [GROUP_ID]: {
          status: 'pending',
          executionId: null,
        },
      },
    })
  })

  it('preserves the optimistic new-attempt handoff through server pickup', () => {
    const optimisticRow = createRow('execution-old', 'pending', { jobId: null })
    const preStampedRow = applyCellEventToRow(optimisticRow, createCellEvent('pending', null))

    expect(preStampedRow).not.toBeNull()
    expect(
      applyCellEventToRow(
        preStampedRow as TableRow,
        createCellEvent('running', 'execution-new', { jobId: 'job-new' })
      )
    ).toMatchObject({
      executions: {
        [GROUP_ID]: {
          status: 'running',
          executionId: 'execution-new',
          jobId: 'job-new',
        },
      },
    })
  })

  it('does not replace a real paused attempt with an id-less pre-stamp', () => {
    const row = createRow('execution-current', 'pending', {
      jobId: 'paused-execution-current',
    })

    expect(applyCellEventToRow(row, createCellEvent('pending', null))).toBeNull()
  })

  it('applies a pending transition to its matching active execution', () => {
    const row = createRow('execution-1', 'running')

    expect(
      applyCellEventToRow(
        row,
        createCellEvent('pending', 'execution-1', { jobId: 'paused-execution-1' })
      )
    ).toMatchObject({
      executions: {
        [GROUP_ID]: {
          status: 'pending',
          executionId: 'execution-1',
          jobId: 'paused-execution-1',
        },
      },
    })
  })

  it('does not seed an identified active event without cached ownership', () => {
    const row: TableRow = {
      id: ROW_ID,
      data: { result: 'current' },
      position: 0,
      executions: {},
    }

    expect(applyCellEventToRow(row, createCellEvent('running', 'execution-1'))).toBeNull()
  })

  it.each(['queued', 'running'] as const)(
    'does not treat an id-less %s event as a pre-stamp',
    (status) => {
      const row = createRow(null, 'pending')

      expect(applyCellEventToRow(row, createCellEvent(status, null))).toBeNull()
    }
  )

  it('does not regress a terminal attempt with a late matching active event', () => {
    const row = createRow('execution-1', 'completed')

    expect(applyCellEventToRow(row, createCellEvent('running', 'execution-1'))).toBeNull()
  })

  it.each(['completed', 'error'] as const)(
    'does not replace cancellation with a delayed same-attempt %s event',
    (status) => {
      const row = createRow('execution-1', 'cancelled')

      expect(applyCellEventToRow(row, createCellEvent(status, 'execution-1'))).toBeNull()
    }
  )

  it('allows cancellation to repair an exact worker error', () => {
    const row = createRow('execution-1', 'error')

    expect(applyCellEventToRow(row, createCellEvent('cancelled', 'execution-1'))).toMatchObject({
      executions: {
        [GROUP_ID]: {
          status: 'cancelled',
          executionId: 'execution-1',
        },
      },
    })
  })

  it.each([
    ['completed', 'error'],
    ['error', 'completed'],
  ] as const)(
    'does not replace a terminal %s state with a delayed same-attempt %s event',
    (currentStatus, delayedStatus) => {
      const row = createRow('execution-1', currentStatus)

      expect(applyCellEventToRow(row, createCellEvent(delayedStatus, 'execution-1'))).toBeNull()
    }
  )

  it('does not apply an identified terminal event over an unclaimed pending attempt', () => {
    const row = createRow(null, 'pending')

    expect(applyCellEventToRow(row, createCellEvent('cancelled', 'execution-old'))).toBeNull()
  })

  it('applies an unclaimed terminal event only to the matching unclaimed attempt', () => {
    const row = createRow(null, 'pending')

    expect(
      applyCellEventToRow(row, createCellEvent('error', null, { error: 'Failed to enqueue run' }))
    ).toMatchObject({
      executions: {
        [GROUP_ID]: {
          status: 'error',
          executionId: null,
          error: 'Failed to enqueue run',
        },
      },
    })
  })

  it('applies a terminal event and outputs to its matching execution', () => {
    const row = createRow('execution-1', 'running')

    expect(
      applyCellEventToRow(
        row,
        createCellEvent('completed', 'execution-1', { outputs: { result: 'finished' } })
      )
    ).toMatchObject({
      data: { result: 'finished' },
      executions: {
        [GROUP_ID]: {
          status: 'completed',
          executionId: 'execution-1',
        },
      },
    })
  })

  it('does not recreate a terminal execution when the cache has no current group state', () => {
    const row: TableRow = {
      id: ROW_ID,
      data: { result: 'current' },
      position: 0,
      executions: {},
    }

    expect(applyCellEventToRow(row, createCellEvent('cancelled', 'execution-old'))).toBeNull()
  })
})

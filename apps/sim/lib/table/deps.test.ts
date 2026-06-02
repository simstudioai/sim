/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  areGroupDepsSatisfied,
  getUnmetGroupDeps,
  isExecCancelled,
  isExecCancelledAfter,
  optimisticallyScheduleNewlyEligibleGroups,
} from '@/lib/table/deps'
import type { RowExecutionMetadata, TableRow, WorkflowGroup } from '@/lib/table/types'

function makeGroup(overrides: Partial<WorkflowGroup> & { id: string }): WorkflowGroup {
  return {
    workflowId: `wf-${overrides.id}`,
    outputs: [{ blockId: 'b1', path: 'out', columnName: `${overrides.id}_out` }],
    ...overrides,
  }
}

function makeRow(
  data: Record<string, unknown> = {},
  executions: Record<string, RowExecutionMetadata> = {}
): TableRow {
  return {
    id: 'row1',
    data: data as TableRow['data'],
    executions,
    position: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

describe('areGroupDepsSatisfied — checkbox dependency', () => {
  const group = makeGroup({ id: 'g1', dependencies: { columns: ['flag'] } })

  it('treats a checked box (true) as satisfied', () => {
    expect(areGroupDepsSatisfied(group, makeRow({ flag: true }))).toBe(true)
  })

  it('treats an unchecked box (false) as unmet', () => {
    expect(areGroupDepsSatisfied(group, makeRow({ flag: false }))).toBe(false)
  })

  it('treats empty / null / undefined as unmet', () => {
    expect(areGroupDepsSatisfied(group, makeRow({ flag: '' }))).toBe(false)
    expect(areGroupDepsSatisfied(group, makeRow({ flag: null }))).toBe(false)
    expect(areGroupDepsSatisfied(group, makeRow({}))).toBe(false)
  })

  it('reports an unchecked box in unmet deps', () => {
    expect(getUnmetGroupDeps(group, makeRow({ flag: false })).columns).toEqual(['flag'])
    expect(getUnmetGroupDeps(group, makeRow({ flag: true })).columns).toEqual([])
  })
})

describe('optimisticallyScheduleNewlyEligibleGroups — checkbox toggle', () => {
  const group = makeGroup({ id: 'g1', autoRun: true, dependencies: { columns: ['flag'] } })

  it('flips the dependent to pending when checking (false → true)', () => {
    const before = makeRow({ flag: false })
    const next = optimisticallyScheduleNewlyEligibleGroups([group], before, { flag: true })
    expect(next?.g1?.status).toBe('pending')
  })

  it('does NOT schedule anything when unchecking (true → false)', () => {
    const before = makeRow({ flag: true }, { g1: completedExec('wf-g1') })
    const next = optimisticallyScheduleNewlyEligibleGroups([group], before, { flag: false })
    expect(next).toBeNull()
  })
})

function completedExec(workflowId: string): RowExecutionMetadata {
  return { status: 'completed', executionId: 'e1', jobId: null, workflowId, error: null }
}

describe('isExecCancelled', () => {
  it('is true only for cancelled status', () => {
    expect(isExecCancelled({ status: 'cancelled' } as RowExecutionMetadata)).toBe(true)
    expect(isExecCancelled({ status: 'running' } as RowExecutionMetadata)).toBe(false)
    expect(isExecCancelled(undefined)).toBe(false)
  })

  it('is true regardless of executionId — the resurrection-bug guard', () => {
    // A stop click can only stamp the pre-stamp's (often null) executionId.
    expect(
      isExecCancelled({ status: 'cancelled', executionId: null } as RowExecutionMetadata)
    ).toBe(true)
  })
})

describe('isExecCancelledAfter — dispatcher tombstone', () => {
  const since = new Date('2026-01-01T00:00:00Z')

  it('is true when cancelled after the dispatch was requested', () => {
    const exec = {
      status: 'cancelled',
      cancelledAt: '2026-01-01T00:00:05Z',
    } as RowExecutionMetadata
    expect(isExecCancelledAfter(exec, since)).toBe(true)
  })

  it('is false for a cancel that predates the dispatch (a prior, cleared run)', () => {
    const exec = {
      status: 'cancelled',
      cancelledAt: '2025-12-31T23:59:59Z',
    } as RowExecutionMetadata
    expect(isExecCancelledAfter(exec, since)).toBe(false)
  })

  it('is false without a cancelledAt timestamp', () => {
    expect(isExecCancelledAfter({ status: 'cancelled' } as RowExecutionMetadata, since)).toBe(false)
  })
})

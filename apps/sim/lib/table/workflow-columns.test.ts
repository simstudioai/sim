/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type {
  RowExecutionMetadata,
  TableDefinition,
  TableRow,
  WorkflowGroup,
} from '@/lib/table/types'
import { pickNextEligibleGroupForRow } from '@/lib/table/workflow-columns'

function makeGroup(overrides: Partial<WorkflowGroup> & { id: string }): WorkflowGroup {
  return {
    workflowId: `wf-${overrides.id}`,
    outputs: [{ blockId: 'b1', path: 'out', columnName: `${overrides.id}_out` }],
    ...overrides,
  }
}

function makeTable(groups: WorkflowGroup[]): TableDefinition {
  return {
    id: 'tbl1',
    name: 'T',
    schema: { columns: [], workflowGroups: groups },
    rowCount: 1,
    maxRows: 1000,
    workspaceId: 'ws1',
    createdBy: 'u1',
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

function makeRow(
  executions: Record<string, RowExecutionMetadata>,
  data: Record<string, unknown> = {}
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

/** The dispatcher's "queued marker" pre-stamp: pending with no executionId. */
function queuedMarker(workflowId: string): RowExecutionMetadata {
  return { status: 'pending', executionId: null, jobId: null, workflowId, error: null }
}

describe('pickNextEligibleGroupForRow — queued-marker handoff', () => {
  it('runs an autoRun:false group that carries a queued marker (explicit request)', () => {
    const group = makeGroup({ id: 'g1', autoRun: false })
    const table = makeTable([group])
    const row = makeRow({ g1: queuedMarker('wf-g1') })

    expect(pickNextEligibleGroupForRow(table, row)?.id).toBe('g1')
  })

  it('does NOT run an autoRun:false group with no marker (auto-cascade respects autoRun)', () => {
    const group = makeGroup({ id: 'g1', autoRun: false })
    const table = makeTable([group])
    const row = makeRow({})

    expect(pickNextEligibleGroupForRow(table, row)).toBeNull()
  })

  it('does NOT run an autoRun:true marker whose deps are unmet (no spin)', () => {
    const group = makeGroup({ id: 'g1', autoRun: true, dependencies: { columns: ['need'] } })
    const table = makeTable([group])
    // marker present, but the dep column is empty → deps-unmet
    const row = makeRow({ g1: queuedMarker('wf-g1') }, { need: '' })

    expect(pickNextEligibleGroupForRow(table, row)).toBeNull()
  })

  it('still runs a normal autoRun:true group whose deps are satisfied (no marker)', () => {
    const group = makeGroup({ id: 'g1', autoRun: true })
    const table = makeTable([group])
    const row = makeRow({})

    expect(pickNextEligibleGroupForRow(table, row)?.id).toBe('g1')
  })

  it('skips excludeGroupId so the just-finished group does not self-retrigger', () => {
    const group = makeGroup({ id: 'g1', autoRun: true })
    const table = makeTable([group])
    const row = makeRow({})

    expect(pickNextEligibleGroupForRow(table, row, 'g1')).toBeNull()
  })
})

/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TableDefinition, WorkflowGroup } from '@/lib/table/types'

const { mockWithLockedTable, mockGetTableById, mockAssertTableRowTtlEnabled } = vi.hoisted(() => ({
  mockWithLockedTable: vi.fn(),
  mockGetTableById: vi.fn(),
  mockAssertTableRowTtlEnabled: vi.fn(),
}))

vi.mock('@/lib/table/service', () => ({
  getTableById: mockGetTableById,
  withLockedTable: mockWithLockedTable,
}))
vi.mock('@/lib/table/mutation-locks', () => ({
  assertColumnDestructive: vi.fn(),
  assertSchemaMutable: vi.fn(),
}))
vi.mock('@/lib/table/rows/secret-provenance', () => ({
  updateTableRowsWithDerivedSecretProvenance: vi.fn(),
}))
vi.mock('@/lib/table/ttl-availability', () => ({
  assertTableRowTtlEnabled: mockAssertTableRowTtlEnabled,
}))
vi.mock('@/lib/table/workflow-columns', () => ({
  runWorkflowColumn: vi.fn().mockResolvedValue(undefined),
  stripGroupDeps: (schema: unknown) => schema,
}))
/**
 * These ceiling fixtures declare groups whose output columns are not in the
 * schema, so the invariant check has to stay stubbed for them to exercise the
 * count limit. It moved to its own leaf module, so the stub follows it.
 */
vi.mock('@/lib/table/schema-invariants', () => ({
  assertValidSchema: vi.fn(),
}))

import { TABLE_LIMITS } from '@/lib/table/constants'
import {
  addWorkflowGroup,
  addWorkflowGroupOutput,
  updateWorkflowGroup,
} from '@/lib/table/workflow-groups/service'

function groupAt(index: number): WorkflowGroup {
  return {
    id: `group-${index}`,
    workflowId: 'workflow-1',
    outputs: [{ blockId: 'block-1', path: 'out', columnName: `out_${index}` }],
  } as WorkflowGroup
}

function tableWithGroups(count: number): TableDefinition {
  return {
    id: 'table-1',
    name: 'People',
    description: null,
    schema: {
      columns: [{ id: 'col_a', name: 'name', type: 'string' }],
      workflowGroups: Array.from({ length: count }, (_unused, index) => groupAt(index)),
    },
    metadata: null,
    rowCount: 0,
    maxRows: 10_000,
    workspaceId: 'workspace-1',
    createdBy: 'user-1',
    archivedAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  } as TableDefinition
}

/**
 * `GET /tables/{id}/groups` is published as a full-set list — one page, always
 * `nextCursor: null`. Nothing made that claim true: the group count had no cap
 * of its own, and the indirect bound (a create must add at least one column, and
 * columns are capped) does not survive an update path that adds none.
 */
describe('addWorkflowGroup group ceiling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAssertTableRowTtlEnabled.mockResolvedValue(undefined)
  })

  function add(existingGroups: number) {
    const table = tableWithGroups(existingGroups)
    mockWithLockedTable.mockImplementation(
      async (_tableId: string, mutate: (t: TableDefinition, trx: unknown) => Promise<unknown>) =>
        mutate(table, {
          update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
          execute: () => Promise.resolve(),
        })
    )
    mockGetTableById.mockResolvedValue(table)
    return addWorkflowGroup(
      {
        tableId: 'table-1',
        workspaceId: 'workspace-1',
        group: groupAt(9999),
        outputColumns: [{ name: 'out_9999', type: 'string', workflowGroupId: 'group-9999' }],
        autoRun: false,
        actorUserId: 'user-1',
      } as Parameters<typeof addWorkflowGroup>[0],
      'request-1'
    )
  }

  it('refuses a create that would cross MAX_WORKFLOW_GROUPS_PER_TABLE', async () => {
    await expect(add(TABLE_LIMITS.MAX_WORKFLOW_GROUPS_PER_TABLE)).rejects.toThrow(
      /maximum of \d+ workflow groups/
    )
  })

  it('allows the create that lands exactly on the ceiling', async () => {
    await expect(add(TABLE_LIMITS.MAX_WORKFLOW_GROUPS_PER_TABLE - 1)).resolves.toBeDefined()
  })
})

describe('workflow group TTL availability', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAssertTableRowTtlEnabled.mockRejectedValue(new Error('Expiration columns are not enabled'))
  })

  it.each([
    [
      'group creation',
      () =>
        addWorkflowGroup(
          {
            tableId: 'table-1',
            workspaceId: 'workspace-1',
            group: groupAt(1),
            outputColumns: [{ name: 'expires_at', type: 'ttl' }],
          } as Parameters<typeof addWorkflowGroup>[0],
          'request-1'
        ),
    ],
    [
      'group update',
      () =>
        updateWorkflowGroup(
          {
            tableId: 'table-1',
            workspaceId: 'workspace-1',
            groupId: 'group-1',
            newOutputColumns: [{ name: 'expires_at', type: 'ttl' }],
          } as Parameters<typeof updateWorkflowGroup>[0],
          'request-1'
        ),
    ],
    [
      'single output addition',
      () =>
        addWorkflowGroupOutput(
          {
            tableId: 'table-1',
            workspaceId: 'workspace-1',
            groupId: 'group-1',
            blockId: 'block-1',
            path: 'expiresAt',
            capabilityGovernedUserId: null,
            resolvedOutput: { workflowId: 'workflow-1', columnType: 'ttl', order: [] },
          },
          'request-1'
        ),
    ],
  ])('rejects TTL introduction through %s while disabled', async (_label, introduceTtl) => {
    await expect(introduceTtl()).rejects.toThrow('Expiration columns are not enabled')
    expect(mockWithLockedTable).not.toHaveBeenCalled()
  })
})

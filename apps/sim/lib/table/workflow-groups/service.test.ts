/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TableDefinition, TableMetadata, TableSchema, WorkflowGroup } from '@/lib/table/types'

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

/**
 * A group may take over columns the table already has. Before this, any
 * `outputColumns` name matching an existing column was refused as a duplicate,
 * so the only way to bind a group to existing data was to recreate the columns.
 */
describe('addWorkflowGroup attaching existing columns', () => {
  const table = {
    ...tableWithGroups(0),
    schema: {
      columns: [
        { id: 'col_name', name: 'name', type: 'string' },
        { id: 'col_tier', name: 'tier', type: 'string' },
      ],
      workflowGroups: [],
    },
    metadata: { columnOrder: ['col_name', 'col_tier'] },
  } as unknown as TableDefinition

  /** Captures the schema the service writes, so the assertions read what would be persisted. */
  function arrangeWrite(current: TableDefinition = table) {
    const set = vi.fn(() => ({ where: () => Promise.resolve() }))
    mockWithLockedTable.mockImplementation(
      async (_tableId: string, mutate: (t: TableDefinition, trx: unknown) => Promise<unknown>) =>
        mutate(current, { update: () => ({ set }), execute: () => Promise.resolve() })
    )
    return () => set.mock.calls[0][0] as { schema: TableSchema; metadata: TableMetadata | null }
  }

  function add(
    outputs: WorkflowGroup['outputs'],
    outputColumns: Array<{ name: string; type: string }>
  ) {
    return addWorkflowGroup(
      {
        tableId: 'table-1',
        workspaceId: 'workspace-1',
        group: { id: 'group-new', workflowId: 'workflow-1', outputs } as WorkflowGroup,
        outputColumns: outputColumns.map((column) => ({
          ...column,
          workflowGroupId: 'group-new',
        })),
        autoRun: false,
        actorUserId: 'user-1',
      } as Parameters<typeof addWorkflowGroup>[0],
      'request-1'
    )
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockAssertTableRowTtlEnabled.mockResolvedValue(undefined)
  })

  it('attaches an existing column named in outputColumns instead of creating a duplicate', async () => {
    const written = arrangeWrite()

    await add(
      [{ blockId: 'block-1', path: 'tier', columnName: 'tier' }],
      [{ name: 'tier', type: 'string' }]
    )

    const { schema, metadata } = written()
    expect(schema.columns).toEqual([
      { id: 'col_name', name: 'name', type: 'string' },
      { id: 'col_tier', name: 'tier', type: 'string', workflowGroupId: 'group-new' },
    ])
    expect(schema.workflowGroups?.[0].outputs).toEqual([
      { blockId: 'block-1', path: 'tier', columnName: 'col_tier' },
    ])
    expect(metadata?.columnOrder).toEqual(['col_name', 'col_tier'])
  })

  it('attaches an existing column an output names with no outputColumns entry, and still creates the missing ones', async () => {
    const written = arrangeWrite()

    await add(
      [
        { blockId: 'block-1', path: 'tier', columnName: 'Tier' },
        { blockId: 'block-1', path: 'score', columnName: 'score' },
      ],
      [{ name: 'score', type: 'number' }]
    )

    const { schema, metadata } = written()
    expect(schema.columns).toHaveLength(3)
    expect(schema.columns[1]).toEqual({
      id: 'col_tier',
      name: 'tier',
      type: 'string',
      workflowGroupId: 'group-new',
    })
    const created = schema.columns[2]
    expect(created).toMatchObject({ name: 'score', type: 'number', workflowGroupId: 'group-new' })
    expect(schema.workflowGroups?.[0].outputs.map((output) => output.columnName)).toEqual([
      'col_tier',
      created.id,
    ])
    expect(metadata?.columnOrder).toEqual(['col_name', 'col_tier', created.id])
  })

  it('refuses to attach a column another group already owns', async () => {
    arrangeWrite({
      ...table,
      schema: {
        columns: [{ id: 'col_tier', name: 'tier', type: 'string', workflowGroupId: 'group-old' }],
        workflowGroups: [
          { id: 'group-old', workflowId: 'workflow-0', outputs: [] } as WorkflowGroup,
        ],
      },
    } as TableDefinition)

    await expect(
      add([{ blockId: 'block-1', path: 'tier', columnName: 'tier' }], [])
    ).rejects.toThrow('already belongs to workflow group "group-old"')
  })

  it('refuses an outputColumns entry whose type disagrees with the existing column', async () => {
    arrangeWrite()

    await expect(
      add(
        [{ blockId: 'block-1', path: 'tier', columnName: 'tier' }],
        [{ name: 'tier', type: 'number' }]
      )
    ).rejects.toThrow('already exists with type "string"')
  })
})

/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TableDefinition } from '@/lib/table/types'

const { mockRunWorkflowColumn, mockWithLockedTable } = vi.hoisted(() => ({
  mockRunWorkflowColumn: vi.fn(),
  mockWithLockedTable: vi.fn(),
}))

vi.mock('@/lib/table/service', () => ({
  getTableById: vi.fn(),
  withLockedTable: mockWithLockedTable,
}))

vi.mock('@/lib/table/workflow-columns', () => ({
  assertValidSchema: vi.fn(),
  runWorkflowColumn: mockRunWorkflowColumn,
  stripGroupDeps: vi.fn((group: unknown) => group),
}))

vi.mock('@/lib/table/backfill-runner', () => ({
  maybeBackfillGroupOutputs: vi.fn(),
}))

import { addWorkflowGroup, updateWorkflowGroup } from '@/lib/table/workflow-groups/service'

function table(autoRun?: boolean): TableDefinition {
  return {
    id: 'table-1',
    name: 'People',
    description: null,
    schema: {
      columns: [],
      ...(autoRun === undefined
        ? {}
        : {
            workflowGroups: [
              {
                id: 'group-1',
                workflowId: 'workflow-1',
                outputs: [],
                autoRun,
              },
            ],
          }),
    },
    metadata: null,
    rowCount: 0,
    maxRows: 100,
    workspaceId: 'workspace-1',
    createdBy: 'workspace-key-owner',
    archivedAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  }
}

describe('workflow-group auto-run billing actor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRunWorkflowColumn.mockResolvedValue({ dispatchId: 'dispatch-1' })
    mockWithLockedTable.mockImplementation(
      async (
        _tableId: string,
        callback: (
          value: TableDefinition,
          transaction: {
            update: () => {
              set: () => { where: () => Promise<void> }
            }
            execute: () => Promise<void>
          }
        ) => Promise<TableDefinition>
      ) =>
        callback(table(), {
          update: () => ({
            set: () => ({ where: async () => undefined }),
          }),
          execute: async () => undefined,
        })
    )
  })

  it('uses the frozen billing actor without replacing mutation ownership', async () => {
    await addWorkflowGroup(
      {
        tableId: 'table-1',
        group: {
          id: 'group-1',
          workflowId: 'workflow-1',
          outputs: [{ blockId: 'block-1', path: 'content', columnName: 'result' }],
        },
        outputColumns: [
          {
            name: 'result',
            type: 'string',
            required: false,
            unique: false,
            workflowGroupId: 'group-1',
          },
        ],
        autoRun: true,
        actorUserId: 'workspace-key-owner',
        billingActorUserId: 'workspace-system-actor',
      },
      'request-1'
    )

    expect(mockRunWorkflowColumn).toHaveBeenCalledWith(
      expect.objectContaining({
        tableId: 'table-1',
        workspaceId: 'workspace-1',
        triggeredByUserId: 'workspace-system-actor',
      })
    )
  })

  it('preserves the existing member-attribution fallback for ordinary callers', async () => {
    await addWorkflowGroup(
      {
        tableId: 'table-1',
        group: {
          id: 'group-1',
          workflowId: 'workflow-1',
          outputs: [{ blockId: 'block-1', path: 'content', columnName: 'result' }],
        },
        outputColumns: [
          {
            name: 'result',
            type: 'string',
            required: false,
            unique: false,
            workflowGroupId: 'group-1',
          },
        ],
        autoRun: true,
        actorUserId: 'interactive-member',
      },
      'request-2'
    )

    expect(mockRunWorkflowColumn).toHaveBeenCalledWith(
      expect.objectContaining({ triggeredByUserId: 'interactive-member' })
    )
  })

  it('uses the frozen billing actor when enabling auto-run on an existing group', async () => {
    mockWithLockedTable.mockImplementationOnce(
      async (
        _tableId: string,
        callback: (
          value: TableDefinition,
          transaction: {
            update: () => {
              set: () => { where: () => Promise<void> }
            }
            execute: () => Promise<void>
          }
        ) => Promise<unknown>
      ) =>
        callback(table(false), {
          update: () => ({
            set: () => ({ where: async () => undefined }),
          }),
          execute: async () => undefined,
        })
    )

    await updateWorkflowGroup(
      {
        tableId: 'table-1',
        groupId: 'group-1',
        autoRun: true,
        actorUserId: 'workspace-key-owner',
        billingActorUserId: 'workspace-system-actor',
      },
      'request-3'
    )

    expect(mockRunWorkflowColumn).toHaveBeenCalledWith(
      expect.objectContaining({
        tableId: 'table-1',
        workspaceId: 'workspace-1',
        groupIds: ['group-1'],
        triggeredByUserId: 'workspace-system-actor',
      })
    )
  })
})

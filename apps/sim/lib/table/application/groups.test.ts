/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TableDefinition, WorkflowGroup } from '@/lib/table/types'

const mocks = vi.hoisted(() => ({
  addGroup: vi.fn(),
  addOutput: vi.fn(),
  audit: vi.fn(),
  resolveContext: vi.fn(),
  resolvePermission: vi.fn(),
  signal: vi.fn(),
  updateGroup: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: { TABLE_UPDATED: 'table.updated' },
  AuditResourceType: { TABLE: 'table' },
  recordAudit: mocks.audit,
}))

vi.mock('@sim/platform-authz/workspace', () => ({
  permissionSatisfies: (actual: string | null, required: string) => {
    const rank = { read: 1, write: 2, admin: 3 } as const
    return (
      actual !== null && rank[actual as keyof typeof rank] >= rank[required as keyof typeof rank]
    )
  },
  resolveEffectiveWorkspacePermission: mocks.resolvePermission,
}))

vi.mock('@sim/utils/id', () => ({ generateId: () => 'generated-id' }))
vi.mock('@/lib/core/utils/background', () => ({ runDetached: vi.fn() }))
vi.mock('@/lib/core/utils/request', () => ({ generateRequestId: () => 'request-1' }))
vi.mock('@/lib/table/application/context', () => ({
  resolveActiveTableContext: mocks.resolveContext,
}))
vi.mock('@/lib/table/application/runs', () => ({ startTableRun: { execute: vi.fn() } }))
vi.mock('@/lib/table/column-naming', () => ({ columnTypeForLeaf: () => 'string' }))
vi.mock('@/lib/table/events', () => ({ signalTableSchemaChanged: mocks.signal }))
vi.mock('@/lib/table/workflow-groups/service', () => ({
  addWorkflowGroup: mocks.addGroup,
  addWorkflowGroupOutput: mocks.addOutput,
  deleteWorkflowGroup: vi.fn(),
  deleteWorkflowGroupOutput: vi.fn(),
  updateWorkflowGroup: mocks.updateGroup,
}))
vi.mock('@/lib/workflows/application/resolve-workflow-outputs', () => ({
  resolveWorkflowOutputs: { execute: vi.fn() },
}))

import {
  addTableGroupOutputUseCase,
  createTableGroupUseCase,
  updateTableGroupUseCase,
} from '@/lib/table/application/groups'

const group: WorkflowGroup = {
  id: 'group-1',
  workflowId: 'workflow-1',
  outputs: [{ blockId: 'block-1', path: 'content', columnName: 'result' }],
}
const table: TableDefinition = {
  id: 'table-1',
  name: 'People',
  description: null,
  schema: {
    columns: [
      { id: 'column-1', name: 'name', type: 'string' },
      {
        id: 'column-2',
        name: 'result',
        type: 'string',
        workflowGroupId: 'group-1',
      },
    ],
    workflowGroups: [group],
  },
  metadata: null,
  rowCount: 1,
  maxRows: 100,
  workspaceId: 'workspace-1',
  createdBy: 'owner-1',
  archivedAt: null,
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  updatedAt: new Date('2026-08-01T00:00:00.000Z'),
}
const principal = {
  kind: 'delegated' as const,
  serviceId: 'copilot',
  subjectUserId: 'user-1',
  workspaceId: 'workspace-1',
  delegationId: 'copilot-tool:tool-1',
  audience: 'sim:tables',
  issuedAt: new Date('2026-08-01T00:00:00.000Z'),
  expiresAt: new Date('2099-08-01T00:00:00.000Z'),
  resourceScope: { tableId: 'table-1' },
}
const resolvedWorkflow = {
  workflowId: 'workflow-1',
  outputs: [
    {
      blockId: 'block-1',
      blockName: 'Agent',
      blockType: 'agent',
      path: 'content',
      leafType: 'string',
    },
    {
      blockId: 'block-2',
      blockName: 'Agent 2',
      blockType: 'agent',
      path: 'score',
      leafType: 'number',
    },
  ],
  executionOrderByBlockId: { 'block-1': 1, 'block-2': 2 },
}

describe('table group application use cases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolvePermission.mockResolvedValue('write')
    mocks.resolveContext.mockResolvedValue({
      tableId: table.id,
      table,
      workspaceId: table.workspaceId,
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'billing-owner-1',
    })
    mocks.addGroup.mockResolvedValue(table)
    mocks.addOutput.mockResolvedValue(table)
    mocks.updateGroup.mockResolvedValue(table)
  })

  it('accepts only Workflow-authorized metadata for delegated group creation', async () => {
    await createTableGroupUseCase.execute({
      principal,
      input: {
        tableId: 'table-1',
        workspaceId: 'workspace-1',
        group,
        outputColumns: [{ name: 'result', type: 'string', workflowGroupId: 'group-1' }],
        resolvedWorkflow,
      },
    })

    expect(mocks.addGroup).toHaveBeenCalledTimes(1)
    expect(mocks.audit).toHaveBeenCalledTimes(1)

    await expect(
      createTableGroupUseCase.execute({
        principal,
        input: {
          tableId: 'table-1',
          workspaceId: 'workspace-1',
          group: { ...group, workflowId: 'workflow-cross-workspace' },
          outputColumns: [{ name: 'result', type: 'string' }],
          resolvedWorkflow,
        },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.addGroup).toHaveBeenCalledTimes(1)
  })

  it('prevents mismatched workflow metadata from being persisted on output add', async () => {
    await expect(
      addTableGroupOutputUseCase.execute({
        principal,
        input: {
          tableId: 'table-1',
          workspaceId: 'workspace-1',
          groupId: 'group-1',
          blockId: 'block-2',
          path: 'score',
          resolvedWorkflow: { ...resolvedWorkflow, workflowId: 'workflow-cross-workspace' },
        },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.addOutput).not.toHaveBeenCalled()
  })

  it('passes authorized output type and ordering to the canonical mutation', async () => {
    await addTableGroupOutputUseCase.execute({
      principal,
      input: {
        tableId: 'table-1',
        workspaceId: 'workspace-1',
        groupId: 'group-1',
        blockId: 'block-2',
        path: 'score',
        resolvedWorkflow,
      },
    })

    expect(mocks.addOutput).toHaveBeenCalledWith(
      expect.objectContaining({
        tableId: 'table-1',
        workspaceId: 'workspace-1',
        resolvedOutput: expect.objectContaining({
          workflowId: 'workflow-1',
          columnType: 'string',
          order: expect.arrayContaining([
            expect.objectContaining({ blockId: 'block-2', executionDistance: 2 }),
          ]),
        }),
      }),
      'request-1'
    )
  })

  it('validates mapping updates against authorized output metadata before mutation', async () => {
    await expect(
      updateTableGroupUseCase.execute({
        principal,
        input: {
          tableId: 'table-1',
          workspaceId: 'workspace-1',
          groupId: 'group-1',
          mappingUpdates: [{ columnName: 'result', blockId: 'missing', path: 'value' }],
          resolvedWorkflow,
        },
      })
    ).rejects.toMatchObject({ code: 'validation' })
    expect(mocks.updateGroup).not.toHaveBeenCalled()
  })

  it('passes authorized mapping types to the canonical group update', async () => {
    await updateTableGroupUseCase.execute({
      principal,
      input: {
        tableId: 'table-1',
        workspaceId: 'workspace-1',
        groupId: 'group-1',
        mappingUpdates: [{ columnName: 'result', blockId: 'block-2', path: 'score' }],
        resolvedWorkflow,
      },
    })

    expect(mocks.updateGroup).toHaveBeenCalledWith(
      expect.objectContaining({
        resolvedMappingTypes: {
          workflowId: 'workflow-1',
          columns: [{ columnName: 'result', type: 'string' }],
        },
      }),
      'request-1'
    )
  })
})

/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { TableDefinition, WorkflowGroup } from '@/lib/table/types'

const mocks = vi.hoisted(() => ({
  addGroup: vi.fn(),
  addOutput: vi.fn(),
  audit: vi.fn(),
  deleteOutput: vi.fn(),
  getEnrichment: vi.fn(),
  loadWorkflowOutputs: vi.fn(),
  resolveContext: vi.fn(),
  resolvePermission: vi.fn(),
  resolveWorkflowContext: vi.fn(),
  runDetached: vi.fn(),
  runWorkflowColumn: vi.fn(),
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
vi.mock('@/enrichments/registry', () => ({ getEnrichment: mocks.getEnrichment }))
vi.mock('@/lib/core/utils/background', () => ({
  runDetached: (label: string, work: () => Promise<unknown>) => {
    mocks.runDetached(label)
    void work()
  },
}))
vi.mock('@/lib/core/utils/request', () => ({ generateRequestId: () => 'request-1' }))
vi.mock('@/lib/table/application/context', () => ({
  resolveActiveTableContext: mocks.resolveContext,
}))
vi.mock('@/lib/table/column-naming', () => ({
  columnTypeForLeaf: (leafType: string | undefined) =>
    leafType === 'number' ? 'number' : 'string',
  deriveOutputColumnName: (path: string, taken: Set<string>) => {
    const base = path.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase()
    if (!taken.has(base)) return base
    return `${base}_0`
  },
}))
vi.mock('@/lib/table/events', () => ({ signalTableSchemaChanged: mocks.signal }))
vi.mock('@/lib/table/workflow-columns', () => ({
  runWorkflowColumn: mocks.runWorkflowColumn,
}))
vi.mock('@/lib/table/workflow-groups/service', () => ({
  addWorkflowGroup: mocks.addGroup,
  addWorkflowGroupOutput: mocks.addOutput,
  deleteWorkflowGroup: vi.fn(),
  deleteWorkflowGroupOutput: mocks.deleteOutput,
  updateWorkflowGroup: mocks.updateGroup,
}))
vi.mock('@/lib/workflows/application/context', () => ({
  resolveActiveWorkflowApplicationContext: mocks.resolveWorkflowContext,
}))
vi.mock('@/lib/workflows/application/resolve-workflow-outputs', () => ({
  loadResolvedWorkflowOutputs: mocks.loadWorkflowOutputs,
}))

import {
  addWorkflowTableGroupOutput,
  createTableEnrichmentGroup,
  createTableGroupUseCase,
  createWorkflowTableGroup,
  deleteTableGroupOutputUseCase,
  updateTableGroupUseCase,
  updateWorkflowTableGroup,
} from '@/lib/table/application/groups'

const group: WorkflowGroup = {
  id: 'group-1',
  workflowId: 'workflow-1',
  outputs: [{ blockId: 'block-1', path: 'content', columnName: 'column-result' }],
}
const table: TableDefinition = {
  id: 'table-1',
  name: 'People',
  description: null,
  schema: {
    columns: [
      { id: 'column-name', name: 'name', type: 'string' },
      { id: 'column-result', name: 'result', type: 'string', workflowGroupId: 'group-1' },
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
  serviceId: 'copilot' as const,
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
      blockName: 'Scorer',
      blockType: 'function',
      path: 'score',
      leafType: 'number',
    },
  ],
  executionOrderByBlockId: { 'block-1': 1, 'block-2': 2 },
}

function tableWithGroup(nextGroup: WorkflowGroup, columns = table.schema.columns): TableDefinition {
  return {
    ...table,
    schema: { ...table.schema, columns, workflowGroups: [nextGroup] },
    updatedAt: new Date('2026-08-02T00:00:00.000Z'),
  }
}

describe('workflow and enrichment Table application commands', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolvePermission.mockResolvedValue('write')
    mocks.runWorkflowColumn.mockResolvedValue({
      dispatchId: 'dispatch-1',
      shouldSignalRowsChanged: false,
    })
    mocks.resolveContext.mockResolvedValue({
      tableId: table.id,
      table,
      workspaceId: table.workspaceId,
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'billing-owner-1',
    })
    mocks.resolveWorkflowContext.mockResolvedValue({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
    })
    mocks.loadWorkflowOutputs.mockResolvedValue(resolvedWorkflow)
    mocks.addGroup.mockImplementation(async ({ group: nextGroup, outputColumns }) =>
      tableWithGroup(nextGroup, [...table.schema.columns, ...outputColumns])
    )
    mocks.addOutput.mockResolvedValue(table)
    mocks.deleteOutput.mockResolvedValue(table)
    mocks.updateGroup.mockImplementation(async (input) =>
      tableWithGroup({
        ...group,
        ...(input.workflowId ? { workflowId: input.workflowId } : {}),
        ...(input.name ? { name: input.name } : {}),
        ...(input.outputs ? { outputs: input.outputs } : {}),
        ...(input.autoRun !== undefined ? { autoRun: input.autoRun } : {}),
      })
    )
    mocks.getEnrichment.mockReturnValue({
      id: 'company-domain',
      name: 'Company Domain',
      inputs: [{ id: 'company', name: 'Company', type: 'string', required: true }],
      outputs: [{ id: 'domain', name: 'domain', type: 'string' }],
    })
  })

  it('owns workflow resolution plus group and column construction', async () => {
    const result = await createWorkflowTableGroup.execute({
      principal,
      input: {
        tableId: table.id,
        workspaceId: table.workspaceId,
        workflowId: 'workflow-1',
        name: 'Scoring',
        outputs: [{ blockId: 'block-2', path: 'score' }],
      },
    })

    expect(mocks.resolveWorkflowContext).toHaveBeenCalledWith({
      workflowId: 'workflow-1',
      assertedWorkspaceId: 'workspace-1',
    })
    expect(mocks.addGroup).toHaveBeenCalledWith(
      expect.objectContaining({
        tableId: table.id,
        workspaceId: table.workspaceId,
        group: expect.objectContaining({
          id: 'generated-id',
          workflowId: 'workflow-1',
          name: 'Scoring',
          autoRun: false,
          outputs: [{ blockId: 'block-2', path: 'score', columnName: 'score' }],
        }),
        outputColumns: [
          expect.objectContaining({
            name: 'score',
            type: 'number',
            workflowGroupId: 'generated-id',
          }),
        ],
      }),
      'request-1'
    )
    expect(result.group.id).toBe('generated-id')
    expect(mocks.audit).toHaveBeenCalledTimes(1)
    expect(mocks.signal).toHaveBeenCalledWith(table.id)
  })

  it('persists disabled auto-run on a newly created workflow group', async () => {
    const result = await createWorkflowTableGroup.execute({
      principal,
      input: {
        tableId: table.id,
        workspaceId: table.workspaceId,
        workflowId: 'workflow-1',
        outputs: [{ blockId: 'block-2', path: 'score' }],
        autoRun: false,
      },
    })

    expect(result.group.autoRun).toBe(false)
    expect(mocks.addGroup).toHaveBeenCalledWith(
      expect.objectContaining({
        group: expect.objectContaining({ autoRun: false }),
        autoRun: false,
      }),
      'request-1'
    )
  })

  it('starts group auto-run without manual rerun semantics', async () => {
    await createWorkflowTableGroup.execute({
      principal,
      input: {
        tableId: table.id,
        workspaceId: table.workspaceId,
        workflowId: 'workflow-1',
        outputs: [{ blockId: 'block-2', path: 'score' }],
        autoRun: true,
      },
    })

    expect(mocks.runDetached).toHaveBeenCalledWith('table-workflow-group-create-auto-run')
    expect(mocks.runWorkflowColumn).toHaveBeenCalledWith({
      tableId: table.id,
      workspaceId: table.workspaceId,
      groupIds: ['generated-id'],
      mode: 'new',
      isManualRun: false,
      requestId: 'request-1',
      triggeredByUserId: 'user-1',
    })
  })

  it('conceals a cross-workspace workflow before group mutation or effects', async () => {
    mocks.resolveWorkflowContext.mockRejectedValueOnce(
      new OrchestrationError('not_found', 'Workflow not found')
    )

    await expect(
      createWorkflowTableGroup.execute({
        principal,
        input: {
          tableId: table.id,
          workspaceId: table.workspaceId,
          workflowId: 'workflow-other',
          outputs: [{ blockId: 'block-2', path: 'score' }],
        },
      })
    ).rejects.toMatchObject({ code: 'not_found' })

    expect(mocks.resolveWorkflowContext).toHaveBeenCalledWith({
      workflowId: 'workflow-other',
      assertedWorkspaceId: table.workspaceId,
    })
    expect(mocks.addGroup).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
    expect(mocks.signal).not.toHaveBeenCalled()
  })

  it('preserves the internal create contract for an invalid related workflow', async () => {
    mocks.resolveWorkflowContext.mockRejectedValueOnce(
      new OrchestrationError('not_found', 'Workflow not found')
    )

    await expect(
      createTableGroupUseCase.execute({
        principal,
        input: {
          tableId: table.id,
          workspaceId: table.workspaceId,
          group: {
            id: 'group-new',
            workflowId: 'workflow-other',
            outputs: [{ blockId: 'block-2', path: 'score', columnName: 'score' }],
          },
          outputColumns: [{ name: 'score', type: 'number' }],
        },
      })
    ).rejects.toMatchObject({ code: 'validation', message: 'Invalid workflow ID' })

    expect(mocks.addGroup).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('preserves the internal update contract for an invalid related workflow', async () => {
    mocks.resolveWorkflowContext.mockRejectedValueOnce(
      new OrchestrationError('not_found', 'Workflow not found')
    )

    await expect(
      updateTableGroupUseCase.execute({
        principal,
        input: {
          tableId: table.id,
          workspaceId: table.workspaceId,
          groupId: group.id,
          workflowId: 'workflow-other',
        },
      })
    ).rejects.toMatchObject({ code: 'validation', message: 'Invalid workflow ID' })

    expect(mocks.updateGroup).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('preserves an existing output coordinate that is no longer pickable', async () => {
    mocks.loadWorkflowOutputs.mockResolvedValueOnce({
      ...resolvedWorkflow,
      outputs: resolvedWorkflow.outputs.filter((output) => output.blockId !== 'block-1'),
    })

    await updateTableGroupUseCase.execute({
      principal,
      input: {
        tableId: table.id,
        workspaceId: table.workspaceId,
        groupId: group.id,
        name: 'Renamed group',
        outputs: group.outputs,
      },
    })

    expect(mocks.resolveWorkflowContext).not.toHaveBeenCalled()
    expect(mocks.loadWorkflowOutputs).not.toHaveBeenCalled()
    expect(mocks.updateGroup).toHaveBeenCalledWith(
      expect.objectContaining({ outputs: group.outputs, name: 'Renamed group' }),
      'request-1'
    )
  })

  it('does not start auto-run when the generic update saves a legacy enabled group', async () => {
    await updateTableGroupUseCase.execute({
      principal,
      input: {
        tableId: table.id,
        workspaceId: table.workspaceId,
        groupId: group.id,
        autoRun: true,
      },
    })

    expect(mocks.updateGroup).toHaveBeenCalledWith(
      expect.objectContaining({
        autoRun: true,
        suppressAutoRunDispatch: true,
      }),
      'request-1'
    )
    expect(mocks.runDetached).not.toHaveBeenCalled()
    expect(mocks.runWorkflowColumn).not.toHaveBeenCalled()
  })

  it('rejects an invalid output before constructing or mutating the group', async () => {
    await expect(
      createWorkflowTableGroup.execute({
        principal,
        input: {
          tableId: table.id,
          workspaceId: table.workspaceId,
          workflowId: 'workflow-1',
          outputs: [{ blockId: 'missing', path: 'value' }],
        },
      })
    ).rejects.toMatchObject({ code: 'validation' })

    expect(mocks.addGroup).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('rejects oversized workflow output construction before resolution or mutation', async () => {
    await expect(
      createWorkflowTableGroup.execute({
        principal,
        input: {
          tableId: table.id,
          workspaceId: table.workspaceId,
          workflowId: 'workflow-1',
          outputs: Array.from({ length: 1001 }, (_, index) => ({
            blockId: `block-${index}`,
            path: 'content',
          })),
        },
      })
    ).rejects.toMatchObject({ code: 'validation' })

    expect(mocks.resolveWorkflowContext).not.toHaveBeenCalled()
    expect(mocks.addGroup).not.toHaveBeenCalled()
  })

  it('constructs new columns while preserving existing bindings during restructure', async () => {
    await updateWorkflowTableGroup.execute({
      principal,
      input: {
        tableId: table.id,
        workspaceId: table.workspaceId,
        groupId: group.id,
        outputs: [
          { blockId: 'block-1', path: 'content', columnName: 'ignored-rename' },
          { blockId: 'block-2', path: 'score', columnName: 'score_value' },
        ],
      },
    })

    expect(mocks.updateGroup).toHaveBeenCalledWith(
      expect.objectContaining({
        outputs: [
          { blockId: 'block-1', path: 'content', columnName: 'column-result' },
          { blockId: 'block-2', path: 'score', columnName: 'score_value' },
        ],
        newOutputColumns: [
          expect.objectContaining({
            name: 'score_value',
            type: 'number',
            workflowGroupId: group.id,
          }),
        ],
      }),
      'request-1'
    )
    expect(mocks.audit).toHaveBeenCalledTimes(1)
    expect(mocks.signal).toHaveBeenCalledWith(table.id)
  })

  it('allows a replacement output to reuse the removed output column name', async () => {
    await updateWorkflowTableGroup.execute({
      principal,
      input: {
        tableId: table.id,
        workspaceId: table.workspaceId,
        groupId: group.id,
        outputs: [{ blockId: 'block-2', path: 'score', columnName: 'result' }],
      },
    })

    expect(mocks.updateGroup).toHaveBeenCalledWith(
      expect.objectContaining({
        outputs: [{ blockId: 'block-2', path: 'score', columnName: 'result' }],
        newOutputColumns: [
          expect.objectContaining({
            name: 'result',
            type: 'number',
            workflowGroupId: group.id,
          }),
        ],
      }),
      'request-1'
    )
  })

  it('propagates a concurrent schema conflict without audit or effects', async () => {
    const conflict = Object.assign(new Error('retry the update'), { code: 'conflict' })
    mocks.updateGroup.mockRejectedValueOnce(conflict)

    await expect(
      updateWorkflowTableGroup.execute({
        principal,
        input: {
          tableId: table.id,
          workspaceId: table.workspaceId,
          groupId: group.id,
          mappingUpdates: [{ columnName: 'column-result', blockId: 'block-2', path: 'score' }],
        },
      })
    ).rejects.toBe(conflict)

    expect(mocks.audit).not.toHaveBeenCalled()
    expect(mocks.signal).not.toHaveBeenCalled()
  })

  it('does not audit or signal an authoritative no-op group update', async () => {
    mocks.updateGroup.mockResolvedValueOnce(table)

    const result = await updateWorkflowTableGroup.execute({
      principal,
      input: {
        tableId: table.id,
        workspaceId: table.workspaceId,
        groupId: group.id,
        name: group.name,
      },
    })

    expect(result.changed).toBe(false)
    expect(mocks.audit).not.toHaveBeenCalled()
    expect(mocks.signal).not.toHaveBeenCalled()
  })

  it('does not start auto-run when the workflow update saves a legacy enabled group', async () => {
    await updateWorkflowTableGroup.execute({
      principal,
      input: {
        tableId: table.id,
        workspaceId: table.workspaceId,
        groupId: group.id,
        autoRun: true,
      },
    })

    expect(mocks.updateGroup).toHaveBeenCalledWith(
      expect.objectContaining({
        autoRun: true,
        suppressAutoRunDispatch: true,
      }),
      'request-1'
    )
    expect(mocks.runDetached).not.toHaveBeenCalled()
    expect(mocks.runWorkflowColumn).not.toHaveBeenCalled()
  })

  it('passes authorized output type and ordering to the add-output mutation', async () => {
    await addWorkflowTableGroupOutput.execute({
      principal,
      input: {
        tableId: table.id,
        workspaceId: table.workspaceId,
        groupId: group.id,
        blockId: 'block-2',
        path: 'score',
      },
    })

    expect(mocks.addOutput).toHaveBeenCalledWith(
      expect.objectContaining({
        resolvedOutput: expect.objectContaining({
          workflowId: 'workflow-1',
          columnType: 'number',
          order: expect.arrayContaining([
            expect.objectContaining({ blockId: 'block-2', executionDistance: 2 }),
          ]),
        }),
      }),
      'request-1'
    )
    expect(mocks.audit).toHaveBeenCalledTimes(1)
    expect(mocks.signal).toHaveBeenCalledWith(table.id)
  })

  it('rejects adding a workflow output to an enrichment group before resolution or mutation', async () => {
    mocks.resolveContext.mockResolvedValueOnce({
      tableId: table.id,
      table: tableWithGroup({
        id: 'enrichment-group-1',
        type: 'enrichment',
        workflowId: '',
        enrichmentId: 'company-domain',
        outputs: [],
      }),
      workspaceId: table.workspaceId,
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'billing-owner-1',
    })

    await expect(
      addWorkflowTableGroupOutput.execute({
        principal,
        input: {
          tableId: table.id,
          workspaceId: table.workspaceId,
          groupId: 'enrichment-group-1',
          blockId: 'block-2',
          path: 'score',
        },
      })
    ).rejects.toMatchObject({ code: 'validation' })

    expect(mocks.resolveWorkflowContext).not.toHaveBeenCalled()
    expect(mocks.loadWorkflowOutputs).not.toHaveBeenCalled()
    expect(mocks.addOutput).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
    expect(mocks.signal).not.toHaveBeenCalled()
  })

  it('validates enrichment mappings before constructing the group', async () => {
    await expect(
      createTableEnrichmentGroup.execute({
        principal,
        input: {
          tableId: table.id,
          workspaceId: table.workspaceId,
          enrichmentId: 'company-domain',
        },
      })
    ).rejects.toMatchObject({ code: 'validation' })
    expect(mocks.addGroup).not.toHaveBeenCalled()

    const result = await createTableEnrichmentGroup.execute({
      principal,
      input: {
        tableId: table.id,
        workspaceId: table.workspaceId,
        enrichmentId: 'company-domain',
        inputMappings: [{ inputName: 'company', columnName: 'name' }],
      },
    })

    expect(mocks.addGroup).toHaveBeenCalledWith(
      expect.objectContaining({
        group: expect.objectContaining({
          id: 'generated-id',
          enrichmentId: 'company-domain',
          inputMappings: [{ inputName: 'company', columnName: 'name' }],
          dependencies: { columns: ['name'] },
          outputs: [{ blockId: '', path: '', outputId: 'domain', columnName: 'domain' }],
        }),
        outputColumns: [
          expect.objectContaining({ name: 'domain', workflowGroupId: 'generated-id' }),
        ],
      }),
      'request-1'
    )
    expect(result.group.enrichmentId).toBe('company-domain')
    expect(mocks.audit).toHaveBeenCalledTimes(1)
    expect(mocks.signal).toHaveBeenCalledWith(table.id)
  })

  it('deletes an output with authoritative audit and schema effects', async () => {
    await deleteTableGroupOutputUseCase.execute({
      principal,
      input: {
        tableId: table.id,
        workspaceId: table.workspaceId,
        groupId: group.id,
        columnName: 'result',
      },
    })

    expect(mocks.deleteOutput).toHaveBeenCalledWith(
      {
        tableId: table.id,
        workspaceId: table.workspaceId,
        groupId: group.id,
        columnName: 'result',
      },
      'request-1'
    )
    expect(mocks.audit).toHaveBeenCalledTimes(1)
    expect(mocks.signal).toHaveBeenCalledWith(table.id)
  })
})

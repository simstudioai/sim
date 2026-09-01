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
  loadResolvedDeployedWorkflowOutputs: mocks.loadWorkflowOutputs,
}))

import { v2WorkflowGroupSchema } from '@/lib/api/contracts/v2/tables'
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
/** An enrichment group stores `workflowId: ''` — there is no workflow to resolve. */
const enrichmentGroup: WorkflowGroup = {
  id: 'group-enrichment',
  workflowId: '',
  enrichmentId: 'company-domain',
  type: 'enrichment',
  outputs: [{ blockId: '', path: '', outputId: 'domain', columnName: 'column-domain' }],
}
const enrichmentTable: TableDefinition = {
  ...table,
  schema: {
    columns: [
      { id: 'column-name', name: 'name', type: 'string' },
      {
        id: 'column-domain',
        name: 'domain',
        type: 'string',
        workflowGroupId: 'group-enrichment',
      },
    ],
    workflowGroups: [enrichmentGroup],
  },
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

/**
 * Points the command at the enrichment table and a registry entry that defines a
 * second output, so an extension has something valid to ask for.
 */
function useEnrichmentTable(): void {
  mocks.resolveContext.mockResolvedValue({
    tableId: table.id,
    table: enrichmentTable,
    workspaceId: table.workspaceId,
    workspaceOrganizationId: null,
    allowPersonalApiKeys: true,
    billedAccountUserId: 'billing-owner-1',
  })
  mocks.getEnrichment.mockReturnValue({
    id: 'company-domain',
    name: 'Company Domain',
    inputs: [{ id: 'company', name: 'Company', type: 'string', required: true }],
    outputs: [
      { id: 'domain', name: 'domain', type: 'string' },
      { id: 'company_name', name: 'company name', type: 'string' },
    ],
  })
  mocks.updateGroup.mockImplementation(async (input) => ({
    ...enrichmentTable,
    schema: {
      ...enrichmentTable.schema,
      workflowGroups: [{ ...enrichmentGroup, outputs: input.outputs ?? enrichmentGroup.outputs }],
    },
  }))
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
      capabilityGovernedUserId: 'user-1',
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

  it('stores an empty workflowId for a public enrichment group that omits it', async () => {
    const result = await createTableGroupUseCase.execute({
      principal,
      input: {
        tableId: table.id,
        workspaceId: table.workspaceId,
        group: {
          type: 'enrichment',
          enrichmentId: 'company-domain',
          name: 'Company Domain',
          outputs: [{ blockId: '', path: '', outputId: 'domain', columnName: 'domain' }],
        },
        outputColumns: [{ name: 'domain', type: 'string' }],
      },
    })

    expect(mocks.resolveWorkflowContext).not.toHaveBeenCalled()
    expect(mocks.addGroup).toHaveBeenCalledWith(
      expect.objectContaining({
        group: expect.objectContaining({ id: 'generated-id', workflowId: '' }),
      }),
      'request-1'
    )
    expect(result.group.workflowId).toBe('')
    expect(v2WorkflowGroupSchema.safeParse(result.group).success).toBe(true)
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

  it('refuses a created enrichment group whose enrichment id the registry does not define', async () => {
    mocks.getEnrichment.mockReturnValue(undefined)

    await expect(
      createTableGroupUseCase.execute({
        principal,
        input: {
          tableId: table.id,
          workspaceId: table.workspaceId,
          group: {
            type: 'enrichment',
            enrichmentId: 'no-such-enrichment',
            outputs: [{ blockId: '', path: '', columnName: 'domain' }],
          },
          outputColumns: [{ name: 'domain', type: 'string' }],
        },
      })
    ).rejects.toMatchObject({
      code: 'validation',
      message: expect.stringContaining('Unknown enrichment "no-such-enrichment"'),
    })

    expect(mocks.addGroup).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('refuses a created enrichment output the registry does not define', async () => {
    await expect(
      createTableGroupUseCase.execute({
        principal,
        input: {
          tableId: table.id,
          workspaceId: table.workspaceId,
          group: {
            type: 'enrichment',
            enrichmentId: 'company-domain',
            outputs: [{ blockId: '', path: '', outputId: 'nosuch', columnName: 'bogus' }],
          },
          outputColumns: [{ name: 'bogus', type: 'string' }],
        },
      })
    ).rejects.toMatchObject({
      code: 'validation',
      message: 'Enrichment "Company Domain" has no output "nosuch"',
    })

    expect(mocks.addGroup).not.toHaveBeenCalled()
  })

  it('refuses a created enrichment output that carries no output id', async () => {
    await expect(
      createTableGroupUseCase.execute({
        principal,
        input: {
          tableId: table.id,
          workspaceId: table.workspaceId,
          group: {
            type: 'enrichment',
            enrichmentId: 'company-domain',
            outputs: [{ blockId: '', path: '', columnName: 'domain' }],
          },
          outputColumns: [{ name: 'domain', type: 'string' }],
        },
      })
    ).rejects.toMatchObject({
      code: 'validation',
      message: 'Enrichment "Company Domain" has no output ""',
    })

    expect(mocks.addGroup).not.toHaveBeenCalled()
  })

  it('refuses a created workflow group output coordinate the workflow cannot produce', async () => {
    await expect(
      createTableGroupUseCase.execute({
        principal,
        input: {
          tableId: table.id,
          workspaceId: table.workspaceId,
          group: {
            id: 'group-new',
            workflowId: 'workflow-1',
            outputs: [{ blockId: 'block-missing', path: 'nope', columnName: 'nope' }],
          },
          outputColumns: [{ name: 'nope', type: 'string' }],
        },
      })
    ).rejects.toMatchObject({
      code: 'validation',
      message: expect.stringContaining('Invalid output(s) for workflow workflow-1'),
    })

    expect(mocks.addGroup).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('still creates a workflow group whose output coordinates the workflow produces', async () => {
    const result = await createTableGroupUseCase.execute({
      principal,
      input: {
        tableId: table.id,
        workspaceId: table.workspaceId,
        group: {
          id: 'group-new',
          workflowId: 'workflow-1',
          outputs: [{ blockId: 'block-2', path: 'score', columnName: 'score' }],
        },
        outputColumns: [{ name: 'score', type: 'number' }],
      },
    })

    expect(mocks.addGroup).toHaveBeenCalledWith(
      expect.objectContaining({
        group: expect.objectContaining({ id: 'group-new', workflowId: 'workflow-1' }),
      }),
      'request-1'
    )
    expect(result.group.workflowId).toBe('workflow-1')
  })

  it('still creates an enrichment-template group that carries a backing workflow', async () => {
    const result = await createTableGroupUseCase.execute({
      principal,
      input: {
        tableId: table.id,
        workspaceId: table.workspaceId,
        group: {
          id: 'group-new',
          type: 'enrichment',
          workflowId: 'workflow-1',
          outputs: [{ blockId: 'block-2', path: 'score', columnName: 'score' }],
        },
        outputColumns: [{ name: 'score', type: 'number' }],
      },
    })

    expect(mocks.getEnrichment).not.toHaveBeenCalled()
    expect(result.group.workflowId).toBe('workflow-1')
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

  it('extends an enrichment group with a registry output without resolving a workflow', async () => {
    useEnrichmentTable()

    await updateTableGroupUseCase.execute({
      principal,
      input: {
        tableId: table.id,
        workspaceId: table.workspaceId,
        groupId: enrichmentGroup.id,
        outputs: [
          ...enrichmentGroup.outputs,
          { blockId: '', path: '', outputId: 'company_name', columnName: 'zz_z' },
        ],
        newOutputColumns: [{ name: 'zz_z', type: 'string' }],
      },
    })

    expect(mocks.resolveWorkflowContext).not.toHaveBeenCalled()
    expect(mocks.updateGroup).toHaveBeenCalledWith(
      expect.objectContaining({
        groupId: enrichmentGroup.id,
        newOutputColumns: [{ name: 'zz_z', type: 'string', workflowGroupId: enrichmentGroup.id }],
      }),
      'request-1'
    )
  })

  it('refuses an enrichment output the registry does not define', async () => {
    useEnrichmentTable()

    await expect(
      updateTableGroupUseCase.execute({
        principal,
        input: {
          tableId: table.id,
          workspaceId: table.workspaceId,
          groupId: enrichmentGroup.id,
          outputs: [
            ...enrichmentGroup.outputs,
            { blockId: '', path: '', outputId: 'invented', columnName: 'zz_z' },
          ],
          newOutputColumns: [{ name: 'zz_z', type: 'string' }],
        },
      })
    ).rejects.toMatchObject({
      code: 'validation',
      message: 'Enrichment "Company Domain" has no output "invented"',
    })

    expect(mocks.updateGroup).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('refuses an enrichment output coordinate that carries no registry output id', async () => {
    useEnrichmentTable()

    await expect(
      updateTableGroupUseCase.execute({
        principal,
        input: {
          tableId: table.id,
          workspaceId: table.workspaceId,
          groupId: enrichmentGroup.id,
          outputs: [...enrichmentGroup.outputs, { blockId: '', path: 'name', columnName: 'zz_z' }],
          newOutputColumns: [{ name: 'zz_z', type: 'string' }],
        },
      })
    ).rejects.toMatchObject({
      code: 'validation',
      message: 'Enrichment "Company Domain" has no output ""',
    })

    expect(mocks.updateGroup).not.toHaveBeenCalled()
  })

  it('leaves an untouched enrichment binding alone while renaming the group', async () => {
    useEnrichmentTable()

    await updateTableGroupUseCase.execute({
      principal,
      input: {
        tableId: table.id,
        workspaceId: table.workspaceId,
        groupId: enrichmentGroup.id,
        name: 'Renamed enrichment',
        outputs: enrichmentGroup.outputs,
      },
    })

    expect(mocks.getEnrichment).not.toHaveBeenCalled()
    expect(mocks.updateGroup).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Renamed enrichment' }),
      'request-1'
    )
  })

  it('refuses relabelling a workflow group as an enrichment', async () => {
    await expect(
      updateTableGroupUseCase.execute({
        principal,
        input: {
          tableId: table.id,
          workspaceId: table.workspaceId,
          groupId: group.id,
          type: 'enrichment',
        },
      })
    ).rejects.toMatchObject({
      code: 'validation',
      message:
        'Workflow group "group-1" cannot change type from "manual" to "enrichment"; create a new group for a different producer',
    })

    expect(mocks.updateGroup).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('refuses relabelling an enrichment group as a workflow group', async () => {
    useEnrichmentTable()

    await expect(
      updateTableGroupUseCase.execute({
        principal,
        input: {
          tableId: table.id,
          workspaceId: table.workspaceId,
          groupId: enrichmentGroup.id,
          type: 'manual',
        },
      })
    ).rejects.toMatchObject({
      code: 'validation',
      message:
        'Workflow group "group-enrichment" cannot change type from "enrichment" to "manual"; create a new group for a different producer',
    })

    expect(mocks.updateGroup).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('accepts a type that echoes the group it is updating', async () => {
    await updateTableGroupUseCase.execute({
      principal,
      input: {
        tableId: table.id,
        workspaceId: table.workspaceId,
        groupId: group.id,
        type: 'manual',
        name: 'Renamed group',
      },
    })

    expect(mocks.updateGroup).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'manual', name: 'Renamed group' }),
      'request-1'
    )
  })

  it('still applies an update that leaves the group type alone', async () => {
    await updateTableGroupUseCase.execute({
      principal,
      input: {
        tableId: table.id,
        workspaceId: table.workspaceId,
        groupId: group.id,
        name: 'Renamed group',
        autoRun: false,
      },
    })

    expect(mocks.updateGroup).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Renamed group', autoRun: false }),
      'request-1'
    )
  })

  it('lets an enrichment-template group backed by a workflow keep its enrichment label', async () => {
    const templateGroup: WorkflowGroup = { ...group, type: 'enrichment' }
    mocks.resolveContext.mockResolvedValue({
      tableId: table.id,
      table: tableWithGroup(templateGroup),
      workspaceId: table.workspaceId,
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: 'billing-owner-1',
    })

    await updateTableGroupUseCase.execute({
      principal,
      input: {
        tableId: table.id,
        workspaceId: table.workspaceId,
        groupId: group.id,
        type: 'enrichment',
        name: 'Renamed template',
      },
    })

    expect(mocks.updateGroup).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'enrichment', name: 'Renamed template' }),
      'request-1'
    )
  })

  it('names the enrichment instead of a missing workflow for a mapping update', async () => {
    useEnrichmentTable()

    await expect(
      updateTableGroupUseCase.execute({
        principal,
        input: {
          tableId: table.id,
          workspaceId: table.workspaceId,
          groupId: enrichmentGroup.id,
          mappingUpdates: [{ columnName: 'column-domain', blockId: 'block-1', path: 'content' }],
        },
      })
    ).rejects.toMatchObject({
      code: 'validation',
      message: 'Mapping updates are not supported for an enrichment group; send outputs[] instead',
    })

    expect(mocks.resolveWorkflowContext).not.toHaveBeenCalled()
    expect(mocks.updateGroup).not.toHaveBeenCalled()
  })

  it('still resolves the workflow for a new output coordinate on a manual group', async () => {
    await updateTableGroupUseCase.execute({
      principal,
      input: {
        tableId: table.id,
        workspaceId: table.workspaceId,
        groupId: group.id,
        outputs: [...group.outputs, { blockId: 'block-2', path: 'score', columnName: 'score' }],
        newOutputColumns: [{ name: 'score', type: 'number' }],
      },
    })

    expect(mocks.resolveWorkflowContext).toHaveBeenCalledWith({
      workflowId: 'workflow-1',
      assertedWorkspaceId: 'workspace-1',
    })
    expect(mocks.getEnrichment).not.toHaveBeenCalled()
    expect(mocks.updateGroup).toHaveBeenCalledWith(
      expect.objectContaining({
        newOutputColumns: [{ name: 'score', type: 'number', workflowGroupId: group.id }],
      }),
      'request-1'
    )
  })

  it('refuses an output column no output names instead of dropping it', async () => {
    await expect(
      updateTableGroupUseCase.execute({
        principal,
        input: {
          tableId: table.id,
          workspaceId: table.workspaceId,
          groupId: group.id,
          newOutputColumns: [{ name: 'zz_w', type: 'string' }],
        },
      })
    ).rejects.toMatchObject({
      code: 'validation',
      message: 'newOutputColumns entry "zz_w" has no matching outputs[].columnName',
    })

    expect(mocks.updateGroup).not.toHaveBeenCalled()
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

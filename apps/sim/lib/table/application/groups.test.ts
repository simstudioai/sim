import { createDelegatedPrincipal } from '@sim/testing/factories/principal.factory'
import { auditMock, auditMockFns } from '@sim/testing/mocks/audit.mock'
import { backgroundTaskMock, backgroundTaskMockFns } from '@sim/testing/mocks/background-task.mock'
import { idMock, idMockFns } from '@sim/testing/mocks/id.mock'
import { requestUtilsMockFns } from '@sim/testing/mocks/request.mock'
import {
  tableApplicationContextMock,
  tableApplicationContextMockFns,
} from '@sim/testing/mocks/table-application-context.mock'
import { tableEventsMock, tableEventsMockFns } from '@sim/testing/mocks/table-events.mock'
import {
  tableWorkflowColumnsMock,
  tableWorkflowColumnsMockFns,
} from '@sim/testing/mocks/table-workflow-columns.mock'
import {
  workflowContextMock,
  workflowContextMockFns,
} from '@sim/testing/mocks/workflow-context.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TableDefinition, WorkflowGroup } from '@/lib/table/types'

const hoisted = vi.hoisted(() => ({
  addGroup: vi.fn(),
  getEnrichment: vi.fn(),
  loadWorkflowOutputs: vi.fn(),
  updateGroup: vi.fn(),
}))

vi.mock('@sim/audit', () => auditMock)
vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@sim/utils/id', () => idMock)
vi.mock('@/enrichments/registry', () => ({ getEnrichment: hoisted.getEnrichment }))
vi.mock('@/lib/core/utils/background', () => backgroundTaskMock)
vi.mock('@/lib/table/application/context', () => tableApplicationContextMock)
vi.mock('@/lib/table/column-naming', () => ({
  columnTypeForLeaf: (leafType: string | undefined) =>
    leafType === 'number' ? 'number' : 'string',
}))
vi.mock('@/lib/table/events', () => tableEventsMock)
vi.mock('@/lib/table/workflow-columns', () => tableWorkflowColumnsMock)
vi.mock('@/lib/table/workflow-groups/service', () => ({
  addWorkflowGroup: hoisted.addGroup,
  deleteWorkflowGroup: vi.fn(),
  updateWorkflowGroup: hoisted.updateGroup,
}))
vi.mock('@/lib/workflows/application/context', () => workflowContextMock)
vi.mock('@/lib/workflows/application/resolve-workflow-outputs', () => ({
  loadResolvedDeployedWorkflowOutputs: hoisted.loadWorkflowOutputs,
}))

import { createTableGroupUseCase, updateTableGroupUseCase } from '@/lib/table/application/groups'

const mocks = {
  ...hoisted,
  resolveContext: tableApplicationContextMockFns.mockResolveActiveTableContext,
  runDetached: backgroundTaskMockFns.mockRunDetached,
  runWorkflowColumn: tableWorkflowColumnsMockFns.mockRunWorkflowColumn,
  audit: auditMockFns.mockRecordAudit,
  resolvePermission: workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission,
  resolveWorkflowContext: workflowContextMockFns.mockResolveActiveWorkflowApplicationContext,
  signal: tableEventsMockFns.mockSignalTableSchemaChanged,
}

mocks.runDetached.mockImplementation((_label: string, work: () => Promise<unknown>) => {
  void work()
})

idMockFns.mockGenerateId.mockReturnValue('generated-id')
requestUtilsMockFns.mockGenerateRequestId.mockReturnValue('request-1')

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
const principal = createDelegatedPrincipal({
  delegationId: 'copilot-tool:tool-1',
  audience: 'sim:tables',
  resourceScope: { tableId: 'table-1' },
})
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

  it('refuses an output whose column is neither declared nor existing', async () => {
    await expect(
      createTableGroupUseCase.execute({
        principal,
        input: {
          tableId: table.id,
          workspaceId: table.workspaceId,
          group: {
            workflowId: 'workflow-1',
            outputs: [{ blockId: 'block-2', path: 'score', columnName: 'tier' }],
          },
          outputColumns: [],
        },
      })
    ).rejects.toMatchObject({
      code: 'validation',
      message: expect.stringContaining('"tier" names neither an outputColumns entry'),
    })

    expect(mocks.addGroup).not.toHaveBeenCalled()
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
})

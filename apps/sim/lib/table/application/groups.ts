import { AuditAction, AuditResourceType } from '@sim/audit'
import { resolvePrincipalAttribution } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { getActiveWorkflowContext } from '@sim/platform-authz/workflow'
import { generateId } from '@sim/utils/id'
import type { V2AddWorkflowGroupBody } from '@/lib/api/contracts/v2/tables'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { runDetached } from '@/lib/core/utils/background'
import { generateRequestId } from '@/lib/core/utils/request'
import type {
  DeleteWorkflowGroupData,
  TableDefinition,
  TableSchema,
  UpdateWorkflowGroupData,
  WorkflowGroup,
} from '@/lib/table'
import { defineAuthorizedTableUseCase } from '@/lib/table/application/authorized-table-use-case'
import { resolveActiveTableContext } from '@/lib/table/application/context'
import { tableOperations } from '@/lib/table/application/operations'
import { startTableRun } from '@/lib/table/application/runs'
import { signalTableSchemaChanged } from '@/lib/table/events'
import {
  addWorkflowGroup,
  deleteWorkflowGroup,
  updateWorkflowGroup,
} from '@/lib/table/workflow-groups/service'

const logger = createLogger('TableGroupApplication')

interface TableGroupInput {
  tableId: string
  workspaceId: string
}

function groupFromTable(table: TableDefinition, groupId: string): WorkflowGroup {
  const group = (table.schema as TableSchema).workflowGroups?.find(
    (candidate) => candidate.id === groupId
  )
  if (!group) {
    throw new Error(`Workflow group ${groupId} missing from the table after a successful write`)
  }
  return group
}

async function requireWorkflowInTableWorkspace(
  workflowId: string,
  workspaceId: string
): Promise<void> {
  const workflow = await getActiveWorkflowContext(workflowId)
  if (!workflow || workflow.workspaceId !== workspaceId) {
    throw new OrchestrationError('validation', 'Workflow not found in this workspace')
  }
}

export const listTableGroupsUseCase = defineAuthorizedTableUseCase({
  operation: tableOperations.listGroups,
  resolveContext: ({ input }: { input: TableGroupInput }) =>
    resolveActiveTableContext({
      tableId: input.tableId,
      assertedWorkspaceId: input.workspaceId,
    }),
  async execute({ context }) {
    return { groups: (context.table.schema as TableSchema).workflowGroups ?? [] }
  },
})

export interface CreateTableGroupInput extends TableGroupInput {
  group: V2AddWorkflowGroupBody['group']
  outputColumns: V2AddWorkflowGroupBody['outputColumns']
  autoRun?: boolean
}

export const createTableGroupUseCase = defineAuthorizedTableUseCase({
  operation: tableOperations.createGroup,
  resolveContext: ({ input }: { input: CreateTableGroupInput }) =>
    resolveActiveTableContext({
      tableId: input.tableId,
      assertedWorkspaceId: input.workspaceId,
    }),
  async execute({ principal, input, context }) {
    if (input.group.workflowId) {
      await requireWorkflowInTableWorkspace(input.group.workflowId, context.workspaceId)
    }
    const outputNames = new Set(input.group.outputs.map((output) => output.columnName))
    const orphan = input.outputColumns.find((column) => !outputNames.has(column.name))
    if (orphan) {
      throw new OrchestrationError(
        'validation',
        `outputColumns entry "${orphan.name}" has no matching group.outputs[].columnName`
      )
    }

    const attribution = resolvePrincipalAttribution(principal, {
      workspaceBillingOwnerUserId: context.billedAccountUserId,
    })
    const groupId = input.group.id ?? generateId()
    const table = await addWorkflowGroup(
      {
        tableId: context.table.id,
        workspaceId: context.workspaceId,
        group: { ...input.group, id: groupId } as WorkflowGroup,
        outputColumns: input.outputColumns.map((column) => ({
          ...column,
          workflowGroupId: groupId,
        })),
        autoRun: input.autoRun ?? false,
        suppressAutoRunDispatch: true,
        actorUserId: attribution.attributedUserId,
      },
      generateRequestId()
    )
    return { table, group: groupFromTable(table, groupId) }
  },
  projectAudit({ result }) {
    return {
      action: AuditAction.TABLE_UPDATED,
      resourceType: AuditResourceType.TABLE,
      resourceId: result.table.id,
      resourceName: result.table.name,
      description: `Added workflow group "${result.group.id}" to table "${result.table.name}"`,
      metadata: { op: 'add_group', groupId: result.group.id },
    }
  },
  afterSuccess({ principal, input, context, result, request }) {
    signalTableSchemaChanged(context.table.id)
    if (input.autoRun === true) {
      runDetached('table-group-create-auto-run', async () => {
        await startTableRun.execute({
          principal,
          input: {
            kind: 'selection',
            tableId: context.table.id,
            assertedWorkspaceId: context.workspaceId,
            groupIds: [result.group.id],
            mode: 'all',
          },
          request,
        })
        logger.info('Started table group auto-run', {
          tableId: context.table.id,
          groupId: result.group.id,
        })
      })
    }
  },
})

export interface UpdateTableGroupInput
  extends TableGroupInput,
    Omit<
      UpdateWorkflowGroupData,
      'tableId' | 'workspaceId' | 'actorUserId' | 'suppressAutoRunDispatch'
    > {}

export const updateTableGroupUseCase = defineAuthorizedTableUseCase({
  operation: tableOperations.updateGroup,
  resolveContext: ({ input }: { input: UpdateTableGroupInput }) =>
    resolveActiveTableContext({
      tableId: input.tableId,
      assertedWorkspaceId: input.workspaceId,
    }),
  async execute({ principal, input, context }) {
    if (input.workflowId !== undefined) {
      await requireWorkflowInTableWorkspace(input.workflowId, context.workspaceId)
    }
    const attribution = resolvePrincipalAttribution(principal, {
      workspaceBillingOwnerUserId: context.billedAccountUserId,
    })
    const previousGroup = (context.table.schema.workflowGroups ?? []).find(
      (group) => group.id === input.groupId
    )
    const table = await updateWorkflowGroup(
      {
        tableId: context.table.id,
        workspaceId: context.workspaceId,
        groupId: input.groupId,
        actorUserId: attribution.attributedUserId,
        suppressAutoRunDispatch: true,
        ...(input.workflowId !== undefined ? { workflowId: input.workflowId } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.dependencies !== undefined ? { dependencies: input.dependencies } : {}),
        ...(input.outputs !== undefined ? { outputs: input.outputs } : {}),
        ...(input.newOutputColumns !== undefined
          ? {
              newOutputColumns: input.newOutputColumns.map((column) => ({
                ...column,
                workflowGroupId: input.groupId,
              })),
            }
          : {}),
        ...(input.mappingUpdates !== undefined ? { mappingUpdates: input.mappingUpdates } : {}),
        ...(input.inputMappings !== undefined ? { inputMappings: input.inputMappings } : {}),
        ...(input.deploymentMode !== undefined ? { deploymentMode: input.deploymentMode } : {}),
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.autoRun !== undefined ? { autoRun: input.autoRun } : {}),
      },
      generateRequestId()
    )
    const group = groupFromTable(table, input.groupId)
    return {
      table,
      group,
      changed:
        JSON.stringify(context.table.schema) !== JSON.stringify(table.schema) ||
        JSON.stringify(context.table.metadata) !== JSON.stringify(table.metadata),
      startAutoRun: previousGroup?.autoRun !== true && input.autoRun === true,
    }
  },
  projectAudit({ result }) {
    if (!result.changed) return []
    return {
      action: AuditAction.TABLE_UPDATED,
      resourceType: AuditResourceType.TABLE,
      resourceId: result.table.id,
      resourceName: result.table.name,
      description: `Updated workflow group "${result.group.id}" in table "${result.table.name}"`,
      metadata: { op: 'update_group', groupId: result.group.id },
    }
  },
  afterSuccess({ principal, context, result, request }) {
    if (result.changed) signalTableSchemaChanged(context.table.id)
    if (result.startAutoRun) {
      runDetached('table-group-update-auto-run', async () => {
        await startTableRun.execute({
          principal,
          input: {
            kind: 'selection',
            tableId: context.table.id,
            assertedWorkspaceId: context.workspaceId,
            groupIds: [result.group.id],
            mode: 'all',
          },
          request,
        })
        logger.info('Started table group auto-run', {
          tableId: context.table.id,
          groupId: result.group.id,
        })
      })
    }
  },
})

export interface DeleteTableGroupInput
  extends TableGroupInput,
    Omit<DeleteWorkflowGroupData, 'tableId' | 'workspaceId'> {}

export const deleteTableGroupUseCase = defineAuthorizedTableUseCase({
  operation: tableOperations.deleteGroup,
  resolveContext: ({ input }: { input: DeleteTableGroupInput }) =>
    resolveActiveTableContext({
      tableId: input.tableId,
      assertedWorkspaceId: input.workspaceId,
    }),
  async execute({ input, context }) {
    const table = await deleteWorkflowGroup(
      {
        tableId: context.table.id,
        workspaceId: context.workspaceId,
        groupId: input.groupId,
      },
      generateRequestId()
    )
    return { table, groupId: input.groupId }
  },
  projectAudit({ result }) {
    return {
      action: AuditAction.TABLE_UPDATED,
      resourceType: AuditResourceType.TABLE,
      resourceId: result.table.id,
      resourceName: result.table.name,
      description: `Deleted workflow group "${result.groupId}" from table "${result.table.name}"`,
      metadata: { op: 'delete_group', groupId: result.groupId },
    }
  },
  afterSuccess({ context }) {
    signalTableSchemaChanged(context.table.id)
  },
})

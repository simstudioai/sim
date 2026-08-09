import { AuditAction, AuditResourceType } from '@sim/audit'
import { type Principal, resolvePrincipalAttribution } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
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
import { columnTypeForLeaf } from '@/lib/table/column-naming'
import { signalTableSchemaChanged } from '@/lib/table/events'
import {
  addWorkflowGroup,
  addWorkflowGroupOutput,
  deleteWorkflowGroup,
  deleteWorkflowGroupOutput,
  updateWorkflowGroup,
} from '@/lib/table/workflow-groups/service'
import type { ResolveWorkflowOutputsResult } from '@/lib/workflows/application/resolve-workflow-outputs'
import { resolveWorkflowOutputs } from '@/lib/workflows/application/resolve-workflow-outputs'

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

async function resolveAuthorizedWorkflowForTableGroup(
  principal: Principal,
  workflowId: string,
  workspaceId: string,
  provided?: ResolveWorkflowOutputsResult
): Promise<ResolveWorkflowOutputsResult> {
  if (provided) {
    if (provided.workflowId !== workflowId) {
      throw new OrchestrationError('not_found', 'Workflow not found')
    }
    return provided
  }
  return resolveWorkflowOutputs.execute({
    principal,
    input: { workflowId, assertedWorkspaceId: workspaceId },
  })
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
  resolvedWorkflow?: ResolveWorkflowOutputsResult
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
      await resolveAuthorizedWorkflowForTableGroup(
        principal,
        input.group.workflowId,
        context.workspaceId,
        input.resolvedWorkflow
      )
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
    > {
  resolvedWorkflow?: ResolveWorkflowOutputsResult
}

export const updateTableGroupUseCase = defineAuthorizedTableUseCase({
  operation: tableOperations.updateGroup,
  resolveContext: ({ input }: { input: UpdateTableGroupInput }) =>
    resolveActiveTableContext({
      tableId: input.tableId,
      assertedWorkspaceId: input.workspaceId,
    }),
  async execute({ principal, input, context }) {
    const previousGroup = (context.table.schema.workflowGroups ?? []).find(
      (group) => group.id === input.groupId
    )
    const workflowMetadataRequired =
      input.workflowId !== undefined ||
      input.outputs !== undefined ||
      (input.mappingUpdates?.length ?? 0) > 0
    const targetWorkflowId = input.workflowId ?? previousGroup?.workflowId
    let resolvedWorkflow: ResolveWorkflowOutputsResult | undefined
    if (workflowMetadataRequired) {
      if (!targetWorkflowId) {
        throw new OrchestrationError('not_found', 'Workflow not found')
      }
      resolvedWorkflow = await resolveAuthorizedWorkflowForTableGroup(
        principal,
        targetWorkflowId,
        context.workspaceId,
        input.resolvedWorkflow
      )
    }
    const attribution = resolvePrincipalAttribution(principal, {
      workspaceBillingOwnerUserId: context.billedAccountUserId,
    })
    const hasMappingUpdates = Boolean(input.mappingUpdates && input.mappingUpdates.length > 0)
    if (hasMappingUpdates && !resolvedWorkflow) {
      throw new Error('Workflow metadata is required for workflow group mapping updates')
    }
    const resolvedMappingTypes =
      input.mappingUpdates && input.mappingUpdates.length > 0 && resolvedWorkflow
        ? {
            workflowId: resolvedWorkflow.workflowId,
            columns: input.mappingUpdates.map((mapping) => {
              const output = resolvedWorkflow.outputs?.find(
                (candidate) =>
                  candidate.blockId === mapping.blockId && candidate.path === mapping.path
              )
              if (!output) {
                throw new OrchestrationError(
                  'validation',
                  `Output ${mapping.blockId}::${mapping.path} is not a valid pickable output on workflow ${targetWorkflowId}`
                )
              }
              return { columnName: mapping.columnName, type: columnTypeForLeaf(output.leafType) }
            }),
          }
        : undefined
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
        ...(resolvedMappingTypes ? { resolvedMappingTypes } : {}),
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

export interface AddTableGroupOutputInput extends TableGroupInput {
  groupId: string
  blockId: string
  path: string
  columnName?: string
  resolvedWorkflow: ResolveWorkflowOutputsResult
}

export const addTableGroupOutputUseCase = defineAuthorizedTableUseCase({
  operation: tableOperations.updateGroup,
  resolveContext: ({ input }: { input: AddTableGroupOutputInput }) =>
    resolveActiveTableContext({
      tableId: input.tableId,
      assertedWorkspaceId: input.workspaceId,
    }),
  async execute({ principal, input, context }) {
    const group = context.table.schema.workflowGroups?.find(
      (candidate) => candidate.id === input.groupId
    )
    if (!group)
      throw new OrchestrationError('not_found', `Workflow group "${input.groupId}" not found`)
    if (group.workflowId !== input.resolvedWorkflow.workflowId) {
      throw new OrchestrationError('not_found', 'Workflow not found')
    }
    const outputs = input.resolvedWorkflow.outputs
    if (!outputs) {
      throw new OrchestrationError('validation', 'Workflow has no pickable outputs')
    }
    const output = outputs.find(
      (candidate) => candidate.blockId === input.blockId && candidate.path === input.path
    )
    if (!output) {
      throw new OrchestrationError(
        'validation',
        `Output ${input.blockId}::${input.path} is not a valid pickable output on workflow ${group.workflowId}`
      )
    }
    const table = await addWorkflowGroupOutput(
      {
        tableId: context.tableId,
        workspaceId: context.workspaceId,
        groupId: input.groupId,
        blockId: input.blockId,
        path: input.path,
        columnName: input.columnName,
        actorUserId: resolvePrincipalAttribution(principal, {
          workspaceBillingOwnerUserId: context.billedAccountUserId,
        }).attributedUserId,
        resolvedOutput: {
          workflowId: input.resolvedWorkflow.workflowId,
          columnType: columnTypeForLeaf(output.leafType),
          order: outputs.map((candidate, discoveryIndex) => {
            const distance = input.resolvedWorkflow.executionOrderByBlockId[candidate.blockId]
            return {
              blockId: candidate.blockId,
              path: candidate.path,
              executionDistance:
                distance === undefined || distance < 0 ? Number.POSITIVE_INFINITY : distance,
              discoveryIndex,
            }
          }),
        },
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
      description: `Added an output to workflow group "${result.groupId}"`,
      metadata: { op: 'add_group_output', groupId: result.groupId },
    }
  },
  afterSuccess({ context }) {
    signalTableSchemaChanged(context.tableId)
  },
})

export interface DeleteTableGroupOutputInput extends TableGroupInput {
  groupId: string
  columnName: string
}

export const deleteTableGroupOutputUseCase = defineAuthorizedTableUseCase({
  operation: tableOperations.updateGroup,
  resolveContext: ({ input }: { input: DeleteTableGroupOutputInput }) =>
    resolveActiveTableContext({
      tableId: input.tableId,
      assertedWorkspaceId: input.workspaceId,
    }),
  async execute({ input, context }) {
    const table = await deleteWorkflowGroupOutput(
      {
        tableId: context.tableId,
        workspaceId: context.workspaceId,
        groupId: input.groupId,
        columnName: input.columnName,
      },
      generateRequestId()
    )
    return { table, groupId: input.groupId, columnName: input.columnName }
  },
  projectAudit({ result }) {
    return {
      action: AuditAction.TABLE_UPDATED,
      resourceType: AuditResourceType.TABLE,
      resourceId: result.table.id,
      resourceName: result.table.name,
      description: `Deleted an output from workflow group "${result.groupId}"`,
      metadata: {
        op: 'delete_group_output',
        groupId: result.groupId,
        columnName: result.columnName,
      },
    }
  },
  afterSuccess({ context }) {
    signalTableSchemaChanged(context.tableId)
  },
})

import { AuditAction, AuditResourceType } from '@sim/audit'
import { resolvePrincipalAttribution } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import type { V2AddWorkflowGroupBody } from '@/lib/api/contracts/v2/tables'
import { asOrchestrationError, OrchestrationError } from '@/lib/core/orchestration/types'
import { runDetached } from '@/lib/core/utils/background'
import { generateRequestId } from '@/lib/core/utils/request'
import {
  type ColumnDefinition,
  type DeleteWorkflowGroupData,
  getColumnId,
  TABLE_LIMITS,
  type TableDefinition,
  type TableSchema,
  type UpdateWorkflowGroupData,
  type WorkflowGroup,
  type WorkflowGroupDependencies,
  type WorkflowGroupDeploymentMode,
  type WorkflowGroupInputMapping,
  type WorkflowGroupOutput,
} from '@/lib/table'
import { defineAuthorizedTableUseCase } from '@/lib/table/application/authorized-table-use-case'
import { resolveActiveTableContext } from '@/lib/table/application/context'
import { tableOperations } from '@/lib/table/application/operations'
import { columnTypeForLeaf, deriveOutputColumnName } from '@/lib/table/column-naming'
import { signalTableSchemaChanged } from '@/lib/table/events'
import { runWorkflowColumn } from '@/lib/table/workflow-columns'
import {
  addWorkflowGroup,
  addWorkflowGroupOutput,
  deleteWorkflowGroup,
  deleteWorkflowGroupOutput,
  updateWorkflowGroup,
} from '@/lib/table/workflow-groups/service'
import { resolveActiveWorkflowApplicationContext } from '@/lib/workflows/application/context'
import type { ResolveWorkflowOutputsResult } from '@/lib/workflows/application/resolve-workflow-outputs'
import { loadResolvedWorkflowOutputs } from '@/lib/workflows/application/resolve-workflow-outputs'
import { getEnrichment } from '@/enrichments/registry'

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

async function resolveWorkflowForAuthorizedTableCommand(
  workflowId: string,
  workspaceId: string
): Promise<ResolveWorkflowOutputsResult> {
  const workflowContext = await resolveActiveWorkflowApplicationContext({
    workflowId,
    assertedWorkspaceId: workspaceId,
  })
  return loadResolvedWorkflowOutputs(workflowContext)
}

async function resolveRelatedWorkflowForTableRoute(
  workflowId: string,
  workspaceId: string
): Promise<ResolveWorkflowOutputsResult> {
  try {
    return await resolveWorkflowForAuthorizedTableCommand(workflowId, workspaceId)
  } catch (error) {
    if (asOrchestrationError(error)?.code === 'not_found') {
      throw new OrchestrationError('validation', 'Invalid workflow ID')
    }
    throw error
  }
}

function requireWorkflowOutputs(
  resolved: ResolveWorkflowOutputsResult,
  workflowId: string
): NonNullable<ResolveWorkflowOutputsResult['outputs']> {
  if (!resolved.outputs) {
    throw new OrchestrationError('validation', `Workflow has no pickable outputs: ${workflowId}`)
  }
  return resolved.outputs
}

function requireBoundedGroupItems(items: readonly unknown[] | undefined, label: string): void {
  if ((items?.length ?? 0) > TABLE_LIMITS.MAX_COLUMNS_PER_TABLE) {
    throw new OrchestrationError(
      'validation',
      `${label} cannot exceed ${TABLE_LIMITS.MAX_COLUMNS_PER_TABLE} entries`
    )
  }
}

function validateRequestedOutputs(
  requested: Array<{ blockId: string; path: string }>,
  resolved: ResolveWorkflowOutputsResult,
  workflowId: string
): NonNullable<ResolveWorkflowOutputsResult['outputs']> {
  const outputs = requireWorkflowOutputs(resolved, workflowId)
  const valid = new Set(outputs.map((output) => `${output.blockId}::${output.path}`))
  const invalid = requested.filter((output) => !valid.has(`${output.blockId}::${output.path}`))
  if (invalid.length === 0) return outputs

  const sample = outputs
    .slice(0, 12)
    .map((output) => `  - ${output.blockId} (${output.blockName}) → ${output.path}`)
    .join('\n')
  const invalidList = invalid.map((output) => `  - ${output.blockId} → ${output.path}`).join('\n')
  throw new OrchestrationError(
    'validation',
    `Invalid output(s) for workflow ${workflowId}:\n${invalidList}\n\nValid options${outputs.length > 12 ? ' (first 12)' : ''}:\n${sample}`
  )
}

function workflowOutputColumnType(
  requestedType: string | undefined,
  resolvedLeafType: string | undefined
): ColumnDefinition['type'] {
  if (requestedType === undefined) return columnTypeForLeaf(resolvedLeafType)
  const type = columnTypeForLeaf(requestedType)
  if (type !== requestedType) {
    throw new OrchestrationError(
      'validation',
      `Invalid workflow output column type "${requestedType}"`
    )
  }
  return type
}

function attributedUserId(
  principal: Parameters<typeof resolvePrincipalAttribution>[0],
  billedAccountUserId: string
): string {
  return resolvePrincipalAttribution(principal, {
    workspaceBillingOwnerUserId: billedAccountUserId,
  }).attributedUserId
}

function dispatchGroupAutoRun(params: {
  tableId: string
  workspaceId: string
  groupId: string
  actorUserId: string
  label: string
}): void {
  runDetached(params.label, async () => {
    await runWorkflowColumn({
      tableId: params.tableId,
      workspaceId: params.workspaceId,
      groupIds: [params.groupId],
      mode: 'new',
      isManualRun: false,
      requestId: generateRequestId(),
      triggeredByUserId: params.actorUserId,
    })
    logger.info('Started table group auto-run', {
      tableId: params.tableId,
      groupId: params.groupId,
    })
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
}

export const createTableGroupUseCase = defineAuthorizedTableUseCase({
  operation: tableOperations.createGroup,
  resolveContext: ({ input }: { input: CreateTableGroupInput }) =>
    resolveActiveTableContext({
      tableId: input.tableId,
      assertedWorkspaceId: input.workspaceId,
    }),
  async execute({ principal, input, context }) {
    requireBoundedGroupItems(input.group.outputs, 'Workflow group outputs')
    requireBoundedGroupItems(input.outputColumns, 'Workflow group output columns')
    requireBoundedGroupItems(input.group.inputMappings, 'Workflow group input mappings')
    if (input.group.workflowId) {
      await resolveRelatedWorkflowForTableRoute(input.group.workflowId, context.workspaceId)
    }
    const outputNames = new Set(input.group.outputs.map((output) => output.columnName))
    const orphan = input.outputColumns.find((column) => !outputNames.has(column.name))
    if (orphan) {
      throw new OrchestrationError(
        'validation',
        `outputColumns entry "${orphan.name}" has no matching group.outputs[].columnName`
      )
    }

    const actorUserId = attributedUserId(principal, context.billedAccountUserId)
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
        actorUserId,
      },
      generateRequestId()
    )
    return { table, group: groupFromTable(table, groupId), actorUserId }
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
  afterSuccess({ input, context, result }) {
    signalTableSchemaChanged(context.table.id)
    if (input.autoRun === true) {
      dispatchGroupAutoRun({
        tableId: context.table.id,
        workspaceId: context.workspaceId,
        groupId: result.group.id,
        actorUserId: result.actorUserId,
        label: 'table-group-create-auto-run',
      })
    }
  },
})

export interface CreateWorkflowTableGroupInput extends TableGroupInput {
  workflowId: string
  outputs: Array<{
    blockId: string
    path: string
    columnName?: string
    columnType?: string
  }>
  name?: string
  dependencies?: WorkflowGroupDependencies
  deploymentMode?: WorkflowGroupDeploymentMode
  autoRun?: boolean
}

/** Creates a workflow-backed group from requested workflow output coordinates. */
export const createWorkflowTableGroup = defineAuthorizedTableUseCase({
  operation: tableOperations.createGroup,
  resolveContext: ({ input }: { input: CreateWorkflowTableGroupInput }) =>
    resolveActiveTableContext({
      tableId: input.tableId,
      assertedWorkspaceId: input.workspaceId,
    }),
  async execute({ principal, input, context }) {
    requireBoundedGroupItems(input.outputs, 'Workflow group outputs')
    if (input.outputs.length === 0) {
      throw new OrchestrationError('validation', 'At least one workflow output is required')
    }
    if (input.outputs.some((output) => !output.blockId || !output.path)) {
      throw new OrchestrationError(
        'validation',
        'Each output entry must include both blockId and path'
      )
    }

    const resolvedWorkflow = await resolveWorkflowForAuthorizedTableCommand(
      input.workflowId,
      context.workspaceId
    )
    const canonicalOutputs = validateRequestedOutputs(
      input.outputs,
      resolvedWorkflow,
      input.workflowId
    )
    const leafTypeByKey = new Map(
      canonicalOutputs.map((output) => [`${output.blockId}::${output.path}`, output.leafType])
    )
    const taken = new Set(context.table.schema.columns.map((column) => column.name))
    const groupId = generateId()
    const outputs: WorkflowGroupOutput[] = []
    const outputColumns: ColumnDefinition[] = []
    for (const requested of input.outputs) {
      const columnName = requested.columnName ?? deriveOutputColumnName(requested.path, taken)
      taken.add(columnName)
      outputs.push({
        blockId: requested.blockId,
        path: requested.path,
        columnName,
      })
      outputColumns.push({
        name: columnName,
        type: workflowOutputColumnType(
          requested.columnType,
          leafTypeByKey.get(`${requested.blockId}::${requested.path}`)
        ),
        required: false,
        unique: false,
        workflowGroupId: groupId,
      })
    }

    const group: WorkflowGroup = {
      id: groupId,
      workflowId: input.workflowId,
      ...(input.name ? { name: input.name } : {}),
      ...(input.dependencies ? { dependencies: input.dependencies } : {}),
      ...(input.deploymentMode ? { deploymentMode: input.deploymentMode } : {}),
      autoRun: input.autoRun ?? false,
      outputs,
    }
    const actorUserId = attributedUserId(principal, context.billedAccountUserId)
    const table = await addWorkflowGroup(
      {
        tableId: context.tableId,
        workspaceId: context.workspaceId,
        group,
        outputColumns,
        autoRun: input.autoRun ?? false,
        suppressAutoRunDispatch: true,
        actorUserId,
      },
      generateRequestId()
    )
    return { table, group: groupFromTable(table, groupId), actorUserId }
  },
  projectAudit({ result }) {
    return {
      action: AuditAction.TABLE_UPDATED,
      resourceType: AuditResourceType.TABLE,
      resourceId: result.table.id,
      resourceName: result.table.name,
      description: `Added workflow group "${result.group.id}" to table "${result.table.name}"`,
      metadata: { op: 'add_workflow_group', groupId: result.group.id },
    }
  },
  afterSuccess({ input, context, result }) {
    signalTableSchemaChanged(context.tableId)
    if (input.autoRun === true) {
      dispatchGroupAutoRun({
        tableId: context.tableId,
        workspaceId: context.workspaceId,
        groupId: result.group.id,
        actorUserId: result.actorUserId,
        label: 'table-workflow-group-create-auto-run',
      })
    }
  },
})

export interface CreateTableEnrichmentGroupInput extends TableGroupInput {
  enrichmentId: string
  inputMappings?: Array<{ inputName: string; columnName: string }>
  outputColumnNames?: Record<string, string>
  dependencies?: WorkflowGroupDependencies
  name?: string
  autoRun?: boolean
}

/** Creates an enrichment group from the code-defined enrichment registry. */
export const createTableEnrichmentGroup = defineAuthorizedTableUseCase({
  operation: tableOperations.createGroup,
  resolveContext: ({ input }: { input: CreateTableEnrichmentGroupInput }) =>
    resolveActiveTableContext({
      tableId: input.tableId,
      assertedWorkspaceId: input.workspaceId,
    }),
  async execute({ principal, input, context }) {
    requireBoundedGroupItems(input.inputMappings, 'Enrichment input mappings')
    if (Object.keys(input.outputColumnNames ?? {}).length > TABLE_LIMITS.MAX_COLUMNS_PER_TABLE) {
      throw new OrchestrationError(
        'validation',
        `Enrichment output names cannot exceed ${TABLE_LIMITS.MAX_COLUMNS_PER_TABLE} entries`
      )
    }
    const enrichment = getEnrichment(input.enrichmentId)
    if (!enrichment) {
      throw new OrchestrationError(
        'validation',
        `Unknown enrichment "${input.enrichmentId}". Call list_enrichments to see available ids.`
      )
    }

    const enrichmentInputIds = new Set(
      enrichment.inputs.map((enrichmentInput) => enrichmentInput.id)
    )
    const mappingByInput = new Map<string, string>()
    for (const mapping of input.inputMappings ?? []) {
      if (!enrichmentInputIds.has(mapping.inputName)) {
        throw new OrchestrationError(
          'validation',
          `Enrichment "${enrichment.name}" has no input "${mapping.inputName}"`
        )
      }
      if (mappingByInput.has(mapping.inputName)) {
        throw new OrchestrationError(
          'validation',
          `Enrichment input "${mapping.inputName}" cannot be mapped more than once`
        )
      }
      mappingByInput.set(mapping.inputName, mapping.columnName)
    }
    const enrichmentOutputIds = new Set(enrichment.outputs.map((output) => output.id))
    for (const outputId of Object.keys(input.outputColumnNames ?? {})) {
      if (!enrichmentOutputIds.has(outputId)) {
        throw new OrchestrationError(
          'validation',
          `Enrichment "${enrichment.name}" has no output "${outputId}"`
        )
      }
    }
    const existingColumns = new Set(context.table.schema.columns.map((column) => column.name))
    for (const enrichmentInput of enrichment.inputs) {
      const mapped = mappingByInput.get(enrichmentInput.id)
      if (enrichmentInput.required && !mapped) {
        throw new OrchestrationError(
          'validation',
          `Enrichment "${enrichment.name}" requires input "${enrichmentInput.id}" to be mapped to a column`
        )
      }
      if (mapped && !existingColumns.has(mapped)) {
        throw new OrchestrationError(
          'validation',
          `Mapped column "${mapped}" for input "${enrichmentInput.id}" does not exist on table ${context.tableId}`
        )
      }
    }

    const inputMappings: WorkflowGroupInputMapping[] = enrichment.inputs
      .filter((enrichmentInput) => mappingByInput.has(enrichmentInput.id))
      .map((enrichmentInput) => ({
        inputName: enrichmentInput.id,
        columnName: mappingByInput.get(enrichmentInput.id) as string,
      }))
    const taken = new Set(context.table.schema.columns.map((column) => column.name))
    const groupId = generateId()
    const outputs: WorkflowGroupOutput[] = []
    const outputColumns: ColumnDefinition[] = []
    for (const output of enrichment.outputs) {
      const desired = (input.outputColumnNames?.[output.id] ?? '').trim() || output.name
      const columnName = deriveOutputColumnName(desired, taken)
      taken.add(columnName)
      outputs.push({ blockId: '', path: '', outputId: output.id, columnName })
      outputColumns.push({
        name: columnName,
        type: output.type,
        required: false,
        unique: false,
        workflowGroupId: groupId,
      })
    }

    const name = input.name ?? enrichment.name
    const group: WorkflowGroup = {
      id: groupId,
      workflowId: '',
      enrichmentId: input.enrichmentId,
      name,
      type: 'enrichment',
      dependencies: input.dependencies ?? { columns: inputMappings.map((item) => item.columnName) },
      outputs,
      inputMappings,
      autoRun: input.autoRun ?? false,
    }
    const actorUserId = attributedUserId(principal, context.billedAccountUserId)
    const table = await addWorkflowGroup(
      {
        tableId: context.tableId,
        workspaceId: context.workspaceId,
        group,
        outputColumns,
        autoRun: input.autoRun ?? false,
        suppressAutoRunDispatch: true,
        actorUserId,
      },
      generateRequestId()
    )
    return { table, group: groupFromTable(table, groupId), actorUserId }
  },
  projectAudit({ result }) {
    return {
      action: AuditAction.TABLE_UPDATED,
      resourceType: AuditResourceType.TABLE,
      resourceId: result.table.id,
      resourceName: result.table.name,
      description: `Added enrichment "${result.group.name ?? result.group.id}" to table "${result.table.name}"`,
      metadata: {
        op: 'add_enrichment',
        groupId: result.group.id,
        enrichmentId: result.group.enrichmentId,
      },
    }
  },
  afterSuccess({ input, context, result }) {
    signalTableSchemaChanged(context.tableId)
    if (input.autoRun === true) {
      dispatchGroupAutoRun({
        tableId: context.tableId,
        workspaceId: context.workspaceId,
        groupId: result.group.id,
        actorUserId: result.actorUserId,
        label: 'table-enrichment-group-create-auto-run',
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
    requireBoundedGroupItems(input.outputs, 'Workflow group outputs')
    requireBoundedGroupItems(input.newOutputColumns, 'Workflow group output columns')
    requireBoundedGroupItems(input.mappingUpdates, 'Workflow group mapping updates')
    requireBoundedGroupItems(input.inputMappings, 'Workflow group input mappings')
    const previousGroup = (context.table.schema.workflowGroups ?? []).find(
      (group) => group.id === input.groupId
    )
    const previousOutputKeys = new Set(
      previousGroup?.outputs.map((output) => `${output.blockId}::${output.path}`) ?? []
    )
    const workflowChanged =
      input.workflowId !== undefined && input.workflowId !== previousGroup?.workflowId
    const outputCoordinatesToValidate =
      input.outputs?.filter(
        (output) => workflowChanged || !previousOutputKeys.has(`${output.blockId}::${output.path}`)
      ) ?? []
    const workflowMetadataRequired =
      input.workflowId !== undefined ||
      outputCoordinatesToValidate.length > 0 ||
      (input.mappingUpdates?.length ?? 0) > 0
    const targetWorkflowId = input.workflowId ?? previousGroup?.workflowId
    let resolvedWorkflow: ResolveWorkflowOutputsResult | undefined
    if (workflowMetadataRequired) {
      if (!targetWorkflowId) {
        throw new OrchestrationError('not_found', 'Workflow not found')
      }
      resolvedWorkflow = await resolveRelatedWorkflowForTableRoute(
        targetWorkflowId,
        context.workspaceId
      )
      if (outputCoordinatesToValidate.length > 0) {
        validateRequestedOutputs(outputCoordinatesToValidate, resolvedWorkflow, targetWorkflowId)
      }
    }
    const actorUserId = attributedUserId(principal, context.billedAccountUserId)
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
        actorUserId,
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
      startAutoRun: previousGroup?.autoRun === false && input.autoRun === true,
      actorUserId,
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
  afterSuccess({ context, result }) {
    if (result.changed) signalTableSchemaChanged(context.table.id)
    if (result.startAutoRun) {
      dispatchGroupAutoRun({
        tableId: context.table.id,
        workspaceId: context.workspaceId,
        groupId: result.group.id,
        actorUserId: result.actorUserId,
        label: 'table-group-update-auto-run',
      })
    }
  },
})

export interface UpdateWorkflowTableGroupInput extends TableGroupInput {
  groupId: string
  workflowId?: string
  name?: string
  dependencies?: WorkflowGroupDependencies
  outputs?: Array<{
    blockId: string
    path: string
    columnName?: string
    columnType?: string
  }>
  mappingUpdates?: Array<{ columnName: string; blockId: string; path: string }>
  deploymentMode?: WorkflowGroupDeploymentMode
  autoRun?: boolean
}

/** Updates a workflow-backed group from output coordinates rather than caller-built columns. */
export const updateWorkflowTableGroup = defineAuthorizedTableUseCase({
  operation: tableOperations.updateGroup,
  resolveContext: ({ input }: { input: UpdateWorkflowTableGroupInput }) =>
    resolveActiveTableContext({
      tableId: input.tableId,
      assertedWorkspaceId: input.workspaceId,
    }),
  async execute({ principal, input, context }) {
    requireBoundedGroupItems(input.outputs, 'Workflow group outputs')
    requireBoundedGroupItems(input.mappingUpdates, 'Workflow group mapping updates')
    const previousGroup = context.table.schema.workflowGroups?.find(
      (candidate) => candidate.id === input.groupId
    )
    if (!previousGroup) {
      throw new OrchestrationError('not_found', `Workflow group "${input.groupId}" not found`)
    }
    if (previousGroup.type === 'enrichment' || !previousGroup.workflowId) {
      throw new OrchestrationError(
        'validation',
        `Workflow group "${input.groupId}" is not backed by a workflow`
      )
    }

    const targetWorkflowId = input.workflowId ?? previousGroup.workflowId
    const workflowMetadataRequired =
      input.workflowId !== undefined ||
      input.outputs !== undefined ||
      (input.mappingUpdates?.length ?? 0) > 0
    const resolvedWorkflow = workflowMetadataRequired
      ? await resolveWorkflowForAuthorizedTableCommand(targetWorkflowId, context.workspaceId)
      : undefined
    if (input.outputs && resolvedWorkflow) {
      validateRequestedOutputs(input.outputs, resolvedWorkflow, targetWorkflowId)
    } else if (input.workflowId && resolvedWorkflow) {
      validateRequestedOutputs(previousGroup.outputs, resolvedWorkflow, targetWorkflowId)
    }

    let outputs: WorkflowGroupOutput[] | undefined
    let newOutputColumns: ColumnDefinition[] | undefined
    if (input.outputs) {
      if (!resolvedWorkflow) {
        throw new Error('Workflow metadata is required to restructure workflow outputs')
      }
      const canonicalOutputs = requireWorkflowOutputs(resolvedWorkflow, targetWorkflowId)
      const leafTypeByKey = new Map(
        canonicalOutputs.map((output) => [`${output.blockId}::${output.path}`, output.leafType])
      )
      const existingByKey = new Map(
        previousGroup.outputs.map((output) => [`${output.blockId}::${output.path}`, output])
      )
      const requestedKeys = new Set(
        input.outputs.map((output) => `${output.blockId}::${output.path}`)
      )
      const releasedColumnIds = new Set(
        previousGroup.outputs
          .filter((output) => !requestedKeys.has(`${output.blockId}::${output.path}`))
          .map((output) => output.columnName)
      )
      const taken = new Set(
        context.table.schema.columns
          .filter((column) => !releasedColumnIds.has(getColumnId(column)))
          .map((column) => column.name)
      )
      outputs = []
      newOutputColumns = []
      for (const requested of input.outputs) {
        const key = `${requested.blockId}::${requested.path}`
        const existing = existingByKey.get(key)
        if (existing) {
          outputs.push(existing)
          continue
        }
        const requestedName = requested.columnName?.trim()
        const columnName = requestedName || deriveOutputColumnName(requested.path, taken)
        if (taken.has(columnName)) {
          throw new OrchestrationError('validation', `Column "${columnName}" already exists`)
        }
        taken.add(columnName)
        outputs.push({
          blockId: requested.blockId,
          path: requested.path,
          columnName,
        })
        newOutputColumns.push({
          name: columnName,
          type: workflowOutputColumnType(requested.columnType, leafTypeByKey.get(key)),
          required: false,
          unique: false,
          workflowGroupId: input.groupId,
        })
      }
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
    if (input.mappingUpdates?.length && !resolvedMappingTypes) {
      throw new Error('Workflow metadata is required for workflow group mapping updates')
    }

    const actorUserId = attributedUserId(principal, context.billedAccountUserId)
    const table = await updateWorkflowGroup(
      {
        tableId: context.tableId,
        workspaceId: context.workspaceId,
        groupId: input.groupId,
        actorUserId,
        suppressAutoRunDispatch: true,
        ...(input.workflowId !== undefined ? { workflowId: input.workflowId } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.dependencies !== undefined ? { dependencies: input.dependencies } : {}),
        ...(outputs !== undefined ? { outputs } : {}),
        ...(newOutputColumns !== undefined ? { newOutputColumns } : {}),
        ...(input.mappingUpdates !== undefined ? { mappingUpdates: input.mappingUpdates } : {}),
        ...(resolvedMappingTypes ? { resolvedMappingTypes } : {}),
        ...(input.deploymentMode !== undefined ? { deploymentMode: input.deploymentMode } : {}),
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
      startAutoRun: previousGroup.autoRun === false && input.autoRun === true,
      actorUserId,
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
      metadata: { op: 'update_workflow_group', groupId: result.group.id },
    }
  },
  afterSuccess({ context, result }) {
    if (result.changed) signalTableSchemaChanged(context.tableId)
    if (result.startAutoRun) {
      dispatchGroupAutoRun({
        tableId: context.tableId,
        workspaceId: context.workspaceId,
        groupId: result.group.id,
        actorUserId: result.actorUserId,
        label: 'table-workflow-group-update-auto-run',
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
}

export const addWorkflowTableGroupOutput = defineAuthorizedTableUseCase({
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
    if (group.type === 'enrichment' || !group.workflowId) {
      throw new OrchestrationError(
        'validation',
        `Workflow group "${input.groupId}" is not backed by a workflow`
      )
    }
    const resolvedWorkflow = await resolveWorkflowForAuthorizedTableCommand(
      group.workflowId,
      context.workspaceId
    )
    const outputs = requireWorkflowOutputs(resolvedWorkflow, group.workflowId)
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
          workflowId: resolvedWorkflow.workflowId,
          columnType: columnTypeForLeaf(output.leafType),
          order: outputs.map((candidate, discoveryIndex) => {
            const distance = resolvedWorkflow.executionOrderByBlockId[candidate.blockId]
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

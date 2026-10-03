import { AuditAction, AuditResourceType } from '@sim/audit'
import { resolvePrincipalAttribution } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import type { V2AddWorkflowGroupBody } from '@/lib/api/contracts/v2/tables'
import { capabilityGovernedPrincipalUserId } from '@/lib/core/application'
import { asOrchestrationError, OrchestrationError } from '@/lib/core/orchestration/types'
import { runDetached } from '@/lib/core/utils/background'
import { generateRequestId } from '@/lib/core/utils/request'
import {
  columnMatchesRef,
  type DeleteWorkflowGroupData,
  TABLE_LIMITS,
  type TableDefinition,
  type TableSchema,
  type UpdateWorkflowGroupData,
  type WorkflowGroup,
} from '@/lib/table'
import { defineAuthorizedTableUseCase } from '@/lib/table/application/authorized-table-use-case'
import { resolveActiveTableContext } from '@/lib/table/application/context'
import { tableOperations } from '@/lib/table/application/operations'
import { columnTypeForLeaf } from '@/lib/table/column-naming'
import { signalTableSchemaChanged } from '@/lib/table/events'
import { runWorkflowColumn } from '@/lib/table/workflow-columns'
import {
  addWorkflowGroup,
  deleteWorkflowGroup,
  updateWorkflowGroup,
} from '@/lib/table/workflow-groups/service'
import { resolveActiveWorkflowApplicationContext } from '@/lib/workflows/application/context'
import type { ResolveWorkflowOutputsResult } from '@/lib/workflows/application/resolve-workflow-outputs'
import { loadResolvedDeployedWorkflowOutputs } from '@/lib/workflows/application/resolve-workflow-outputs'
import { getEnrichment } from '@/enrichments/registry'
import type { EnrichmentConfig } from '@/enrichments/types'

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
  return loadResolvedDeployedWorkflowOutputs(workflowContext)
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

/** Resolves the registry enrichment a group is bound to, refusing an unknown id. */
function requireEnrichment(enrichmentId: string | undefined): EnrichmentConfig {
  const enrichment = getEnrichment(enrichmentId)
  if (!enrichment) {
    throw new OrchestrationError(
      'validation',
      `Unknown enrichment "${enrichmentId ?? ''}". Call list_enrichments to see available ids.`
    )
  }
  return enrichment
}

/**
 * Refuses an output id the enrichment registry does not define. A run fills a
 * cell by reading `result[outputId]`, so a coordinate carrying an unknown — or
 * absent — output id names a column no run can ever write.
 */
function requireKnownEnrichmentOutputIds(
  enrichment: EnrichmentConfig,
  outputIds: Array<string | undefined>
): void {
  const known = new Set(enrichment.outputs.map((output) => output.id))
  for (const outputId of outputIds) {
    if (!outputId || !known.has(outputId)) {
      throw new OrchestrationError(
        'validation',
        `Enrichment "${enrichment.name}" has no output "${outputId ?? ''}"`
      )
    }
  }
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
  /**
   * The gate's subject, which is not the meter's `actorUserId`; `null` means no
   * acting person. See {@link InsertRowData.capabilityGovernedUserId} in `@/lib/table/types`.
   */
  capabilityGovernedUserId: string | null
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
      capabilityGovernedUserId: params.capabilityGovernedUserId,
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
    return {
      table: context.table,
      groups: (context.table.schema as TableSchema).workflowGroups ?? [],
    }
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
    /**
     * Creation must refuse the coordinate an update refuses. A group stores the
     * mapping a run reads to fill a cell, so an output naming a workflow output
     * that does not exist — or an enrichment output the registry does not
     * define — creates a column nothing can ever populate, and the caller only
     * discovers it when they later try to edit the group.
     *
     * `workflowId` is the producer discriminator, not `type`: an enrichment
     * template spawned from the workflow sidebar carries `type: 'enrichment'`
     * with a backing workflow and workflow output coordinates, and only a group
     * with no workflow is filled from the enrichment registry.
     */
    if (input.group.workflowId) {
      const resolvedWorkflow = await resolveRelatedWorkflowForTableRoute(
        input.group.workflowId,
        context.workspaceId
      )
      validateRequestedOutputs(
        input.group.outputs.map((output) => ({
          blockId: output.blockId ?? '',
          path: output.path ?? '',
        })),
        resolvedWorkflow,
        input.group.workflowId
      )
    } else if (input.group.enrichmentId) {
      requireKnownEnrichmentOutputIds(
        requireEnrichment(input.group.enrichmentId),
        input.group.outputs.map((output) => output.outputId)
      )
    }
    const outputColumns = input.outputColumns ?? []
    const outputNames = new Set(input.group.outputs.map((output) => output.columnName))
    const orphan = outputColumns.find((column) => !outputNames.has(column.name))
    if (orphan) {
      throw new OrchestrationError(
        'validation',
        `outputColumns entry "${orphan.name}" has no matching group.outputs[].columnName`
      )
    }
    /**
     * Every output needs a column to land in: one this call creates, or one the
     * table already has, which the group attaches instead of recreating. Checked
     * here so the caller learns the offending name rather than hitting the
     * schema invariant's generic failure inside the write.
     */
    const providedNames = new Set(outputColumns.map((column) => column.name))
    const existingColumns = (context.table.schema as TableSchema).columns
    const homeless = input.group.outputs.find(
      (output) =>
        !providedNames.has(output.columnName) &&
        !existingColumns.some((column) => columnMatchesRef(column, output.columnName))
    )
    if (homeless) {
      throw new OrchestrationError(
        'validation',
        `group.outputs[].columnName "${homeless.columnName}" names neither an outputColumns entry nor an existing column`
      )
    }

    const actorUserId = attributedUserId(principal, context.billedAccountUserId)
    const capabilityGovernedUserId = capabilityGovernedPrincipalUserId(principal)
    const groupId = input.group.id ?? generateId()
    /**
     * The public surface lets an `enrichment` group omit `workflowId`, so the
     * stored blob must supply the same `''` a first-party enrichment group
     * stores — a missing key fails every later read of the group.
     */
    const group: WorkflowGroup = {
      ...input.group,
      id: groupId,
      workflowId: input.group.workflowId ?? '',
      outputs: input.group.outputs.map((output) => ({
        ...output,
        blockId: output.blockId ?? '',
        path: output.path ?? '',
      })),
    }
    const table = await addWorkflowGroup(
      {
        tableId: context.table.id,
        workspaceId: context.workspaceId,
        group,
        outputColumns: outputColumns.map((column) => ({
          ...column,
          workflowGroupId: groupId,
        })),
        autoRun: input.autoRun ?? false,
        suppressAutoRunDispatch: true,
        actorUserId,
        capabilityGovernedUserId,
      },
      generateRequestId()
    )
    return {
      table,
      group: groupFromTable(table, groupId),
      actorUserId,
      capabilityGovernedUserId,
    }
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
        capabilityGovernedUserId: result.capabilityGovernedUserId,
        label: 'table-group-create-auto-run',
      })
    }
  },
})

export interface UpdateTableGroupInput
  extends TableGroupInput,
    Omit<
      UpdateWorkflowGroupData,
      | 'tableId'
      | 'workspaceId'
      | 'actorUserId'
      | 'capabilityGovernedUserId'
      | 'suppressAutoRunDispatch'
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
    /**
     * `type` is provenance, not a producer switch. What a run actually reads is
     * the pair the group was created with — `workflowId` for a workflow-backed
     * group, `enrichmentId` for a registry one — and neither is settable here:
     * the update body has no `enrichmentId` field at all. So a `type` flip only
     * ever relabels a group into a coordinate creation refuses, and one it
     * cannot be talked back out of.
     *
     * `manual` → `enrichment` leaves `enrichmentId` undefined, which is the
     * exact shape `refineGroupSource` rejects on create. `enrichment` →
     * `manual` is worse — it keeps `enrichmentId`
     * but steers the runner off the enrichment branch and onto the workflow
     * one, where the group's `workflowId` is `''` and every cell run fails.
     *
     * Re-sending the type the group already has stays a no-op, so a caller that
     * echoes back a whole group is unaffected.
     */
    if (
      previousGroup &&
      input.type !== undefined &&
      input.type !== (previousGroup.type ?? 'manual')
    ) {
      throw new OrchestrationError(
        'validation',
        `Workflow group "${input.groupId}" cannot change type from "${previousGroup.type ?? 'manual'}" to "${input.type}"; create a new group for a different producer`
      )
    }
    /**
     * An enrichment group's outputs come from the registry, not from a workflow,
     * and it stores `workflowId: ''` — so there is nothing to resolve a new
     * output coordinate against. Validating one anyway resolved the empty id and
     * answered `404 Workflow not found`, which made an enrichment group's output
     * set permanently unextendable. Only a body that supplies a `workflowId`
     * converts the group to workflow-backed and needs workflow metadata.
     */
    const producerIsEnrichment =
      input.workflowId === undefined &&
      previousGroup !== undefined &&
      (previousGroup.type === 'enrichment' || !previousGroup.workflowId)
    /**
     * Skipping workflow resolution must not mean skipping validation. An
     * enrichment run fills a column by registry `outputId`, so a coordinate the
     * registry does not define is a column nothing can ever populate. Hold an
     * added — or repointed — output to the same check enrichment creation
     * applies, and leave an untouched existing binding alone so a group whose
     * enrichment has since changed stays editable.
     */
    if (producerIsEnrichment && input.outputs?.length) {
      const boundOutputKeys = new Set(
        previousGroup?.outputs.map((output) => `${output.columnName}::${output.outputId ?? ''}`) ??
          []
      )
      const addedOutputs = input.outputs.filter(
        (output) => !boundOutputKeys.has(`${output.columnName}::${output.outputId ?? ''}`)
      )
      if (addedOutputs.length > 0) {
        requireKnownEnrichmentOutputIds(
          requireEnrichment(previousGroup?.enrichmentId),
          addedOutputs.map((output) => output.outputId)
        )
      }
    }
    /**
     * `mappingUpdates` repoints a column at a new `(blockId, path)` — coordinates
     * an enrichment output does not have and the writer cannot translate into an
     * `outputId`. Say that, rather than resolving the group's empty workflow id
     * and answering `404 Workflow not found`.
     */
    if (producerIsEnrichment && input.mappingUpdates?.length) {
      throw new OrchestrationError(
        'validation',
        'Mapping updates are not supported for an enrichment group; send outputs[] instead'
      )
    }
    /**
     * A `newOutputColumns` entry that no resulting output names is dropped by the
     * writer, so a caller asking for a column got a 200 and no column. Refuse it
     * the way group creation refuses an orphan `outputColumns` entry.
     */
    if (input.newOutputColumns?.length) {
      const requestedOutputNames = new Set((input.outputs ?? []).map((output) => output.columnName))
      const orphan = input.newOutputColumns.find((column) => !requestedOutputNames.has(column.name))
      if (orphan) {
        throw new OrchestrationError(
          'validation',
          `newOutputColumns entry "${orphan.name}" has no matching outputs[].columnName`
        )
      }
    }
    const previousOutputKeys = new Set(
      previousGroup?.outputs.map((output) => `${output.blockId}::${output.path}`) ?? []
    )
    const workflowChanged =
      input.workflowId !== undefined && input.workflowId !== previousGroup?.workflowId
    const outputCoordinatesToValidate = producerIsEnrichment
      ? []
      : (input.outputs?.filter(
          (output) =>
            workflowChanged || !previousOutputKeys.has(`${output.blockId}::${output.path}`)
        ) ?? [])
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
    const capabilityGovernedUserId = capabilityGovernedPrincipalUserId(principal)
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
        capabilityGovernedUserId,
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
      capabilityGovernedUserId,
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
        capabilityGovernedUserId: result.capabilityGovernedUserId,
        label: 'table-group-update-auto-run',
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

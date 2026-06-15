/**
 * Workflow-group operations on user tables.
 *
 * Extracted from the table service: add/update/delete workflow groups and their
 * output columns, plus stale-output pruning after a workflow deploy. These ops
 * mutate `schema.workflowGroups` (and the bound output columns + row data) under
 * the per-table advisory lock from `withLockedTable`.
 */

import { db } from '@sim/db'
import { userTableDefinitions } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull, sql } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'
import {
  columnMatchesRef,
  generateColumnId,
  getColumnId,
  remapGroupColumnRefs,
} from '@/lib/table/column-keys'
import { NAME_PATTERN, TABLE_LIMITS } from '@/lib/table/constants'
import { stripGroupExecutions } from '@/lib/table/rows/executions'
import { getTableById, withLockedTable } from '@/lib/table/service'
import { setTableTxTimeouts } from '@/lib/table/tx'
import type {
  AddWorkflowGroupData,
  ColumnDefinition,
  DeleteWorkflowGroupData,
  TableDefinition,
  TableMetadata,
  TableSchema,
  UpdateWorkflowGroupData,
  WorkflowGroup,
  WorkflowGroupOutput,
} from '@/lib/table/types'
import { assertValidSchema, runWorkflowColumn, stripGroupDeps } from '@/lib/table/workflow-columns'

const logger = createLogger('TableWorkflowGroupsService')
/**
 * Drops references to deleted blocks from every workflow group on every table
 * that targets the just-deployed workflow. Called from the workflow deploy
 * orchestrator after the new deployment commits, so the table UI never holds
 * stale `{blockId, path}` entries for blocks the user removed.
 *
 * - Filters `outputs[]` per group. If every output would be filtered out, the
 *   group is left untouched and a warning is logged — the user must
 *   reconfigure it manually.
 * - Scoped to the workflow's workspace.
 * - Idempotent: running twice with the same `validBlockIds` is a no-op on the
 *   second pass. Existing row data is left alone.
 */
export async function pruneStaleWorkflowGroupOutputs({
  workflowId,
  workspaceId,
  validBlockIds,
  requestId,
  tx,
}: {
  workflowId: string
  workspaceId: string
  validBlockIds: Set<string>
  requestId: string
  tx?: DbOrTx
}): Promise<void> {
  const executor = tx ?? db
  const tables = await executor
    .select({
      id: userTableDefinitions.id,
      schema: userTableDefinitions.schema,
    })
    .from(userTableDefinitions)
    .where(
      and(
        eq(userTableDefinitions.workspaceId, workspaceId),
        isNull(userTableDefinitions.archivedAt)
      )
    )

  for (const t of tables) {
    const schema = t.schema as TableSchema
    const groups = schema.workflowGroups ?? []
    if (groups.length === 0) continue

    let mutated = false
    const nextGroups = groups.map((group) => {
      if (group.workflowId !== workflowId) return group
      const filtered = group.outputs.filter((o) => validBlockIds.has(o.blockId))
      if (filtered.length === group.outputs.length) return group
      if (filtered.length === 0) {
        logger.warn(
          `[${requestId}] All outputs for workflow group "${group.name ?? group.id}" in table ${t.id} reference deleted blocks; leaving group intact for user reconfiguration.`
        )
        return group
      }
      mutated = true
      return { ...group, outputs: filtered }
    })

    if (!mutated) continue

    await executor
      .update(userTableDefinitions)
      .set({
        schema: { ...schema, workflowGroups: nextGroups },
        updatedAt: new Date(),
      })
      .where(eq(userTableDefinitions.id, t.id))

    logger.info(`[${requestId}] Pruned stale workflow=${workflowId} block refs from table ${t.id}`)
  }
}

/**
 * Atomically inserts a workflow group plus its output columns into a table's
 * schema. Both arrays update in one DB write so the schema is never observed
 * mid-mutation (e.g. columns referencing a group that doesn't yet exist).
 */
export async function addWorkflowGroup(
  data: AddWorkflowGroupData,
  requestId: string
): Promise<TableDefinition> {
  const updatedTable = await withLockedTable(data.tableId, async (table, trx) => {
    const schema = table.schema
    const groups = schema.workflowGroups ?? []
    if (groups.some((g) => g.id === data.group.id)) {
      throw new Error(`Workflow group "${data.group.id}" already exists`)
    }

    const existingNames = new Set(schema.columns.map((c) => c.name.toLowerCase()))
    for (const col of data.outputColumns) {
      if (!NAME_PATTERN.test(col.name)) {
        throw new Error(
          `Invalid output column name "${col.name}". Must satisfy ${NAME_PATTERN.source}.`
        )
      }
      if (existingNames.has(col.name.toLowerCase())) {
        throw new Error(`Column "${col.name}" already exists`)
      }
    }

    if (schema.columns.length + data.outputColumns.length > TABLE_LIMITS.MAX_COLUMNS_PER_TABLE) {
      throw new Error(
        `Adding ${data.outputColumns.length} columns would exceed the maximum (${TABLE_LIMITS.MAX_COLUMNS_PER_TABLE}).`
      )
    }

    // Assign stable ids to the new output columns, then rewrite the group's
    // column refs from name → id so outputs/deps/inputMappings key on ids —
    // matching the row-data storage key and surviving future renames.
    const outputColumns = data.outputColumns.map((col) =>
      col.id ? col : { ...col, id: generateColumnId() }
    )
    const updatedColumns = [...schema.columns, ...outputColumns]
    const idByName = new Map(updatedColumns.map((c) => [c.name, getColumnId(c)]))
    const group = remapGroupColumnRefs(data.group, idByName)

    const updatedSchema: TableSchema = {
      ...schema,
      columns: updatedColumns,
      workflowGroups: [...groups, group],
    }

    // Keep `metadata.columnOrder` (column ids) in sync — see `addTableColumn`.
    // New output columns get appended in the order the caller supplied.
    const existingOrder = table.metadata?.columnOrder
    let updatedMetadata = table.metadata
    if (existingOrder && existingOrder.length > 0) {
      const known = new Set(existingOrder)
      const append = outputColumns.map(getColumnId).filter((id) => !known.has(id))
      if (append.length > 0) {
        updatedMetadata = { ...table.metadata, columnOrder: [...existingOrder, ...append] }
      }
    }

    assertValidSchema(updatedSchema, updatedMetadata?.columnOrder)

    const now = new Date()
    await trx
      .update(userTableDefinitions)
      .set({ schema: updatedSchema, metadata: updatedMetadata, updatedAt: now })
      .where(eq(userTableDefinitions.id, data.tableId))

    logger.info(
      `[${requestId}] Added workflow group "${data.group.id}" with ${data.outputColumns.length} output column(s) to table ${data.tableId}`
    )

    return {
      ...table,
      schema: updatedSchema,
      metadata: updatedMetadata,
      updatedAt: now,
    }
  })

  // Auto-fire existing rows whose deps are already met for the new group.
  // Fire-and-forget — the dispatcher bounds queue depth (window of 20) and
  // walks the table in the background. HTTP returns instantly; cells fill
  // in over the next minutes as the dispatcher walks. Mothership opts out
  // by setting `autoRun: false`.
  if (data.autoRun !== false) {
    void runWorkflowColumn({
      tableId: updatedTable.id,
      workspaceId: updatedTable.workspaceId,
      mode: 'new',
      isManualRun: false,
      groupIds: [data.group.id],
      requestId,
      triggeredByUserId: data.actorUserId,
    }).catch((err) => logger.error(`[${requestId}] auto-dispatch (addWorkflowGroup) failed:`, err))
  }

  return updatedTable
}

/**
 * Updates a workflow group: any combination of workflowId, name, dependencies,
 * outputs[]. Computes added/removed outputs vs current state and inserts /
 * removes columns transactionally. Removed outputs also clear their key from
 * every row's `data`.
 */
export async function updateWorkflowGroup(
  data: UpdateWorkflowGroupData,
  requestId: string
): Promise<TableDefinition> {
  const mappingUpdates = data.mappingUpdates ?? []

  // Phase 1 (no lock): when there are mapping updates, load the workflow once to
  // resolve each remap's new leaf type. Kept OFF the advisory-lock critical
  // section so concurrent group edits on the same table don't time out waiting
  // on this DB load. Best-effort — a resolution failure leaves column types
  // unchanged (workflow deleted, block removed). The result is applied against
  // the fresh schema under the lock in phase 2.
  const remapLeafTypeByColumn = new Map<string, ColumnDefinition['type']>()
  // The workflow id the leaf types above were resolved against. Phase 2 only
  // applies the resolved types if the group still points at this workflow under
  // the lock — a concurrent `workflowId` change would make them stale.
  let resolvedForWorkflowId: string | undefined
  if (mappingUpdates.length > 0) {
    try {
      const preTable = await getTableById(data.tableId)
      const preGroup = preTable?.schema.workflowGroups?.find((g) => g.id === data.groupId)
      const targetWorkflowId = data.workflowId ?? preGroup?.workflowId
      if (targetWorkflowId) {
        resolvedForWorkflowId = targetWorkflowId
        const [
          { loadWorkflowFromNormalizedTables },
          { flattenWorkflowOutputs },
          { columnTypeForLeaf },
        ] = await Promise.all([
          import('@/lib/workflows/persistence/utils'),
          import('@/lib/workflows/blocks/flatten-outputs'),
          import('@/lib/table/column-naming'),
        ])
        const normalized = await loadWorkflowFromNormalizedTables(targetWorkflowId)
        if (normalized) {
          const blocks = Object.values(normalized.blocks ?? {}).map((b) => ({
            id: b.id,
            type: b.type,
            name: b.name,
            triggerMode: (b as { triggerMode?: boolean }).triggerMode,
            subBlocks: b.subBlocks as Record<string, unknown> | undefined,
          }))
          const flattened = flattenWorkflowOutputs(blocks, normalized.edges ?? [])
          const flatByKey = new Map(flattened.map((f) => [`${f.blockId}::${f.path}`, f]))
          for (const u of mappingUpdates) {
            const match = flatByKey.get(`${u.blockId}::${u.path}`)
            if (!match) continue
            const newType = columnTypeForLeaf(match.leafType)
            if (newType) remapLeafTypeByColumn.set(u.columnName, newType)
          }
        }
      }
    } catch (err) {
      logger.warn(
        `[${requestId}] Could not resolve new leaf types for remap on group ${data.groupId}; leaving column types unchanged:`,
        err
      )
    }
  }

  const { updatedTable, added, remappedColumnIds, newOutputs, previousAutoRun } =
    await withLockedTable(data.tableId, async (table, trx) => {
      await setTableTxTimeouts(trx, { statementMs: 60_000 })

      const schema = table.schema
      const groups = schema.workflowGroups ?? []
      const groupIndex = groups.findIndex((g) => g.id === data.groupId)
      if (groupIndex === -1) {
        throw new Error(`Workflow group "${data.groupId}" not found`)
      }
      const group = groups[groupIndex]

      // Normalize every caller-supplied column reference to its stable id, so
      // the diff/splice/clear logic below operates uniformly in id-space (the
      // row-data storage key). New output columns get ids first; then output
      // `columnName`, deps, input mappings, and mapping-update targets are
      // remapped name → id. Callers that already pass ids are unaffected.
      const newColDefs = (data.newOutputColumns ?? []).map((col) =>
        col.id ? col : { ...col, id: generateColumnId() }
      )
      const idByName = new Map(
        [...schema.columns, ...newColDefs].map((c) => [c.name, getColumnId(c)])
      )
      const remapRef = (ref: string) => idByName.get(ref) ?? ref
      const outputsInput = data.outputs?.map((o) => ({ ...o, columnName: remapRef(o.columnName) }))
      const dependenciesInput = data.dependencies
        ? { columns: data.dependencies.columns?.map(remapRef) }
        : undefined
      const inputMappingsInput = data.inputMappings?.map((m) => ({
        ...m,
        columnName: remapRef(m.columnName),
      }))
      const mappingUpdatesNorm = mappingUpdates.map((u) => ({
        ...u,
        columnName: remapRef(u.columnName),
      }))
      // Re-key the out-of-lock leaf-type resolution to ids to match.
      const remapLeafTypeById = new Map<string, ColumnDefinition['type']>()
      for (const [name, type] of remapLeafTypeByColumn) remapLeafTypeById.set(remapRef(name), type)

      // Apply `mappingUpdates` first: each entry repoints an existing output's
      // `(blockId, path)` while preserving the column. We patch the **old** view
      // of outputs so the downstream `(blockId, path)`-keyed diff doesn't see the
      // swap as a remove+add. The corresponding row data is cleared after the
      // schema write so stale values from the old source don't linger.
      const remappedColumnIds = new Set<string>()
      // Per-column type override (keyed by id) resolved (out-of-lock) from the
      // new mapping's leaf type. Only populated when a remap actually changes
      // the column's type against the fresh schema.
      const remappedColumnTypes = new Map<string, ColumnDefinition['type']>()
      let oldOutputs = group.outputs
      if (mappingUpdatesNorm.length > 0) {
        const updateById = new Map(mappingUpdatesNorm.map((u) => [u.columnName, u]))
        for (const u of mappingUpdatesNorm) {
          const exists = oldOutputs.some((o) => o.columnName === u.columnName)
          if (!exists) {
            throw new Error(
              `Mapping update for unknown column "${u.columnName}" (group ${data.groupId}).`
            )
          }
        }
        oldOutputs = oldOutputs.map((o) => {
          const u = updateById.get(o.columnName)
          if (!u) return o
          remappedColumnIds.add(o.columnName)
          return { ...o, blockId: u.blockId, path: u.path }
        })

        // Only apply the out-of-lock leaf-type resolution if the group still
        // points at the workflow we resolved against. If a concurrent writer
        // changed `workflowId` between phase 1 and now, those types are stale —
        // leave column types unchanged (best-effort, same as a resolution
        // failure) rather than stamping types from the old workflow.
        const finalWorkflowId = data.workflowId ?? group.workflowId
        if (remapLeafTypeById.size > 0 && resolvedForWorkflowId !== finalWorkflowId) {
          logger.warn(
            `[${requestId}] Workflow group "${data.groupId}" workflowId changed between leaf-type resolution and apply; leaving remapped column types unchanged.`
          )
        } else {
          const colById = new Map(schema.columns.map((c) => [getColumnId(c), c]))
          for (const u of mappingUpdatesNorm) {
            const newType = remapLeafTypeById.get(u.columnName)
            if (!newType) continue
            const oldType = colById.get(u.columnName)?.type
            if (newType !== oldType) {
              remappedColumnTypes.set(u.columnName, newType)
            }
          }
        }
      }

      // If the caller passed `outputs`, that's the new full set. If only
      // `mappingUpdates` was sent, the new set is the remapped old set.
      const newOutputs = outputsInput ?? oldOutputs
      // Enrichment outputs all share empty `blockId`/`path`, so keying on those
      // alone collapses every sibling to one entry (dropping columns on diff). Key
      // on the registry `outputId` when present; fall back to `blockId::path` for
      // workflow outputs.
      const oldKey = (o: WorkflowGroupOutput) =>
        o.outputId ? `out::${o.outputId}` : `${o.blockId}::${o.path}`
      const oldByKey = new Map(oldOutputs.map((o) => [oldKey(o), o]))
      const newByKey = new Map(newOutputs.map((o) => [oldKey(o), o]))

      const removed = oldOutputs.filter((o) => !newByKey.has(oldKey(o)))
      const added = newOutputs.filter((o) => !oldByKey.has(oldKey(o)))
      const newColById = new Map(newColDefs.map((c) => [getColumnId(c), c]))

      for (const out of added) {
        if (!newColById.has(out.columnName)) {
          throw new Error(
            `Missing column definition for new output "${out.columnName}" (group ${data.groupId}).`
          )
        }
      }

      const removedColumnIds = new Set(removed.map((o) => o.columnName))
      let nextColumns = schema.columns
        .filter((c) => !removedColumnIds.has(getColumnId(c)))
        .map((c) => {
          const newType = remappedColumnTypes.get(getColumnId(c))
          return newType ? { ...c, type: newType } : c
        })
      if (newColDefs.length > 0) {
        // Splice the new column defs into the group's contiguous run rather than
        // appending at the end. The desired in-group order is `newOutputs` (the
        // sidebar's BFS-of-the-workflow ordering); we walk it, anchor at the first
        // surviving sibling's index in `nextColumns`, and emit each output's
        // column def in turn.
        const groupColIds = new Set(newOutputs.map((o) => o.columnName))
        const firstGroupIdx = nextColumns.findIndex((c) => groupColIds.has(getColumnId(c)))
        const anchorIdx = firstGroupIdx === -1 ? nextColumns.length : firstGroupIdx
        const orderedGroupCols: ColumnDefinition[] = []
        for (const out of newOutputs) {
          const fresh = newColById.get(out.columnName)
          if (fresh) {
            orderedGroupCols.push(fresh)
          } else {
            const existing = nextColumns.find((c) => getColumnId(c) === out.columnName)
            if (existing) orderedGroupCols.push(existing)
          }
        }
        const remaining = nextColumns.filter((c) => !groupColIds.has(getColumnId(c)))
        nextColumns = [
          ...remaining.slice(0, anchorIdx),
          ...orderedGroupCols,
          ...remaining.slice(anchorIdx),
        ]
      }

      const updatedGroup: WorkflowGroup = {
        ...group,
        workflowId: data.workflowId ?? group.workflowId,
        name: data.name ?? group.name,
        dependencies: dependenciesInput ?? group.dependencies,
        outputs: newOutputs,
        ...(inputMappingsInput !== undefined ? { inputMappings: inputMappingsInput } : {}),
        ...(data.deploymentMode !== undefined ? { deploymentMode: data.deploymentMode } : {}),
        ...(data.type !== undefined ? { type: data.type } : {}),
        ...(data.autoRun !== undefined ? { autoRun: data.autoRun } : {}),
      }
      // Removed outputs may be referenced as deps by sibling groups; strip those
      // refs so we don't leave dangling-column deps that fail schema validation.
      const nextGroups = groups
        .map((g, i) => (i === groupIndex ? updatedGroup : g))
        .map((g) => (g.id === updatedGroup.id ? g : stripGroupDeps(g, removedColumnIds)))
      const updatedSchema: TableSchema = {
        ...schema,
        columns: nextColumns,
        workflowGroups: nextGroups,
      }

      // `columnOrder` (column ids) mirrors the schema layout. Drop removed
      // columns, then splice the new ones in at the same anchor as `nextColumns`
      // so the table renders them inside the group's contiguous run.
      let updatedColumnOrder = table.metadata?.columnOrder?.filter(
        (id) => !removedColumnIds.has(id)
      )
      if (updatedColumnOrder && newColDefs.length > 0) {
        const newColIds = new Set(newColDefs.map(getColumnId))
        const orderWithoutNew = updatedColumnOrder.filter((id) => !newColIds.has(id))
        const groupColIds = new Set(newOutputs.map((o) => o.columnName))
        const orderedGroupIds = newOutputs.map((o) => o.columnName)
        const firstGroupOrderIdx = orderWithoutNew.findIndex((id) => groupColIds.has(id))
        const anchorOrderIdx =
          firstGroupOrderIdx === -1 ? orderWithoutNew.length : firstGroupOrderIdx
        const remainingOrder = orderWithoutNew.filter((id) => !groupColIds.has(id))
        updatedColumnOrder = [
          ...remainingOrder.slice(0, anchorOrderIdx),
          ...orderedGroupIds,
          ...remainingOrder.slice(anchorOrderIdx),
        ]
      }
      assertValidSchema(updatedSchema, updatedColumnOrder)

      const updatedMetadata: TableMetadata | null =
        updatedColumnOrder && table.metadata
          ? { ...table.metadata, columnOrder: updatedColumnOrder }
          : table.metadata
            ? { ...table.metadata }
            : null

      const now = new Date()
      await trx
        .update(userTableDefinitions)
        .set({ schema: updatedSchema, metadata: updatedMetadata, updatedAt: now })
        .where(eq(userTableDefinitions.id, data.tableId))
      for (const id of removedColumnIds) {
        await trx.execute(
          sql`UPDATE user_table_rows SET data = data - ${id}::text WHERE table_id = ${data.tableId} AND data ? ${id}::text`
        )
      }
      // Remapped columns: clear stale values in-tx so rows the backfill can't
      // repopulate (no log, no matching span output) end up empty rather than
      // retaining the previous mapping's value. The backfill below then writes
      // the new mapping's value into rows where it can find one.
      for (const id of remappedColumnIds) {
        if (removedColumnIds.has(id)) continue
        await trx.execute(
          sql`UPDATE user_table_rows SET data = data - ${id}::text WHERE table_id = ${data.tableId} AND data ? ${id}::text`
        )
      }

      logger.info(
        `[${requestId}] Updated workflow group "${data.groupId}" in table ${data.tableId} (added=${added.length}, removed=${removed.length}, remapped=${remappedColumnIds.size})`
      )

      const updatedTable: TableDefinition = {
        ...table,
        schema: updatedSchema,
        metadata: updatedMetadata,
        updatedAt: now,
      }
      return {
        updatedTable,
        added,
        remappedColumnIds,
        newOutputs,
        previousAutoRun: group.autoRun,
      }
    })

  // Backfill from saved execution logs so already-completed group runs surface
  // the schema changes without re-running the workflow. Two passes:
  //   - added outputs (new columns): never overwrite hand-edited values.
  //   - remapped outputs (existing column re-pointed): overwrite, since the
  //     new mapping is the source of truth and the user expects the cell to
  //     refresh to the new output's value.
  // Small tables backfill inline-awaited (response returns with consistent
  // data); large ones run as a background job. A failed backfill is logged
  // but doesn't fail the request — the schema change has already committed.
  // Lazy import: backfill-runner closes a cycle back to this module.
  const { maybeBackfillGroupOutputs } = await import('@/lib/table/backfill-runner')
  if (added.length > 0) {
    try {
      await maybeBackfillGroupOutputs({
        table: updatedTable,
        groupId: data.groupId,
        outputs: added,
        overwrite: false,
        requestId,
        actorUserId: data.actorUserId,
      })
    } catch (err) {
      logger.warn(
        `[${requestId}] Backfill from execution logs failed for ${data.tableId} group ${data.groupId}:`,
        err
      )
    }
  }
  if (remappedColumnIds.size > 0) {
    const remappedOutputs = newOutputs.filter((o) => remappedColumnIds.has(o.columnName))
    try {
      await maybeBackfillGroupOutputs({
        table: updatedTable,
        groupId: data.groupId,
        outputs: remappedOutputs,
        overwrite: true,
        requestId,
        actorUserId: data.actorUserId,
      })
    } catch (err) {
      logger.warn(
        `[${requestId}] Remap backfill from execution logs failed for ${data.tableId} group ${data.groupId}:`,
        err
      )
    }
  }

  // autoRun toggled false → true: fire deps-satisfied rows now via the
  // dispatcher. Mirrors the post-add path so re-enabling auto-fire doesn't
  // require manual run clicks for rows that are already eligible.
  if (previousAutoRun === false && data.autoRun === true) {
    void runWorkflowColumn({
      tableId: updatedTable.id,
      workspaceId: updatedTable.workspaceId,
      mode: 'new',
      isManualRun: false,
      groupIds: [data.groupId],
      requestId,
      triggeredByUserId: data.actorUserId,
    }).catch((err) =>
      logger.error(`[${requestId}] auto-dispatch (updateWorkflowGroup autoRun=true) failed:`, err)
    )
  }

  return updatedTable
}

/**
 * Adds a single output to an existing workflow group. Mirrors `addTableColumn`
 * for plain columns: one canonical op, one column created, type inferred from
 * the workflow's flattened outputs (`leafType` for `(blockId, path)`). The
 * column is spliced into the group's contiguous run so the table renders the
 * new output next to its siblings.
 */
export async function addWorkflowGroupOutput(
  data: {
    tableId: string
    groupId: string
    blockId: string
    path: string
    /** Optional override; defaults to a slug derived from `path`. */
    columnName?: string
    /** The member adding the output — billed/gated for any backfill-triggered re-run. */
    actorUserId?: string | null
  },
  requestId: string
): Promise<TableDefinition> {
  // Phase 1 (no lock): load the workflow and resolve the pickable output plus
  // its execution-order index. This depends only on the workflow graph (which
  // is stable), so it runs OFF the advisory-lock critical section — holding the
  // lock during this DB load would make concurrent adders on the same table
  // time out waiting (the Mothership fan-out this fix targets). Phase 2
  // re-validates that the group still maps to the same workflow under the lock.
  const preTable = await getTableById(data.tableId)
  if (!preTable) throw new Error('Table not found')
  const preGroup = (preTable.schema.workflowGroups ?? []).find((g) => g.id === data.groupId)
  if (!preGroup) {
    throw new Error(`Workflow group "${data.groupId}" not found`)
  }
  const workflowId = preGroup.workflowId

  const [
    { loadWorkflowFromNormalizedTables },
    { flattenWorkflowOutputs, getBlockExecutionOrder },
    { columnTypeForLeaf, deriveOutputColumnName },
  ] = await Promise.all([
    import('@/lib/workflows/persistence/utils'),
    import('@/lib/workflows/blocks/flatten-outputs'),
    import('@/lib/table/column-naming'),
  ])
  const normalized = await loadWorkflowFromNormalizedTables(workflowId)
  if (!normalized) {
    throw new Error(`Workflow ${workflowId} not found`)
  }
  const blocks = Object.values(normalized.blocks ?? {}).map((b) => ({
    id: b.id,
    type: b.type,
    name: b.name,
    triggerMode: (b as { triggerMode?: boolean }).triggerMode,
    subBlocks: b.subBlocks as Record<string, unknown> | undefined,
  }))
  const flattened = flattenWorkflowOutputs(blocks, normalized.edges ?? [])
  const match = flattened.find((f) => f.blockId === data.blockId && f.path === data.path)
  if (!match) {
    throw new Error(
      `Output ${data.blockId}::${data.path} is not a valid pickable output on workflow ${workflowId}`
    )
  }
  const newColumnType = columnTypeForLeaf(match.leafType)
  const distances = getBlockExecutionOrder(blocks, normalized.edges ?? [])
  const flatIndex = new Map(flattened.map((f, i) => [`${f.blockId}::${f.path}`, i]))

  // Phase 2 (locked): re-read fresh, validate against the current schema, and
  // write. The critical section holds no I/O — just the in-memory splice + the
  // schema UPDATE — so concurrent adders queue behind it quickly.
  const { updatedTable, newOutput } = await withLockedTable(data.tableId, async (table, trx) => {
    const schema = table.schema
    const groups = schema.workflowGroups ?? []
    const groupIndex = groups.findIndex((g) => g.id === data.groupId)
    if (groupIndex === -1) {
      throw new Error(`Workflow group "${data.groupId}" not found`)
    }
    const group = groups[groupIndex]
    if (group.workflowId !== workflowId) {
      throw new Error(
        `Workflow group "${data.groupId}" was remapped to a different workflow concurrently; retry the add.`
      )
    }

    if (group.outputs.some((o) => o.blockId === data.blockId && o.path === data.path)) {
      throw new Error(
        `Workflow group "${data.groupId}" already has an output at ${data.blockId}::${data.path}`
      )
    }

    const taken = new Set(schema.columns.map((c) => c.name))
    const columnName = data.columnName ?? deriveOutputColumnName(data.path, taken)
    if (!NAME_PATTERN.test(columnName)) {
      throw new Error(`Invalid column name "${columnName}". Must satisfy ${NAME_PATTERN.source}.`)
    }
    if (taken.has(columnName)) {
      throw new Error(`Column "${columnName}" already exists`)
    }
    if (schema.columns.length + 1 > TABLE_LIMITS.MAX_COLUMNS_PER_TABLE) {
      throw new Error(
        `Adding a column would exceed the maximum (${TABLE_LIMITS.MAX_COLUMNS_PER_TABLE}).`
      )
    }

    const newColDef: ColumnDefinition = {
      id: generateColumnId(),
      name: columnName,
      type: newColumnType,
      required: false,
      unique: false,
      workflowGroupId: data.groupId,
    }
    const newColumnId = getColumnId(newColDef)
    const newOutput: WorkflowGroupOutput = {
      blockId: data.blockId,
      path: data.path,
      columnName: newColumnId,
    }

    // Sort all of the group's outputs (existing + new) in workflow execution
    // order: BFS distance from the start block ASC, with discovery order as
    // tiebreak. This matches what the column-sidebar does at create time, so
    // columns from the same workflow always read in the order their blocks run
    // — regardless of whether they were added at create time or one-by-one.
    const groupColIdsBefore = new Set(group.outputs.map((o) => o.columnName))
    const orderKey = (o: { blockId: string; path: string }) => {
      const d = distances[o.blockId]
      const dist = d === undefined || d < 0 ? Number.POSITIVE_INFINITY : d
      const idx = flatIndex.get(`${o.blockId}::${o.path}`) ?? Number.POSITIVE_INFINITY
      return [dist, idx] as const
    }
    const allGroupOutputs = [...group.outputs, newOutput].sort((a, b) => {
      const [da, ia] = orderKey(a)
      const [db, ib] = orderKey(b)
      return da !== db ? da - db : ia - ib
    })
    const orderedGroupColIds = allGroupOutputs.map((o) => o.columnName)
    const updatedGroup: WorkflowGroup = {
      ...group,
      outputs: allGroupOutputs,
    }
    const nextGroups = groups.map((g, i) => (i === groupIndex ? updatedGroup : g))

    // Splice the new column run into nextColumns: keep the columns outside the
    // group where they were, replace the group's contiguous run with the
    // BFS-ordered list. Anchor at the position of the first existing sibling
    // (or append if the group was empty).
    const colById = new Map(schema.columns.map((c) => [getColumnId(c), c]))
    const orderedGroupCols: ColumnDefinition[] = orderedGroupColIds.map((id) => {
      if (id === newColumnId) return newColDef
      const existing = colById.get(id)
      if (!existing) {
        throw new Error(`Internal: column "${id}" missing while splicing group outputs`)
      }
      return existing
    })
    const remainingCols = schema.columns.filter((c) => !groupColIdsBefore.has(getColumnId(c)))
    const firstGroupIdx = schema.columns.findIndex((c) => groupColIdsBefore.has(getColumnId(c)))
    const colAnchor = firstGroupIdx === -1 ? remainingCols.length : firstGroupIdx
    const nextColumns = [
      ...remainingCols.slice(0, colAnchor),
      ...orderedGroupCols,
      ...remainingCols.slice(colAnchor),
    ]

    const updatedSchema: TableSchema = {
      ...schema,
      columns: nextColumns,
      workflowGroups: nextGroups,
    }

    const updatedColumnOrder = table.metadata?.columnOrder
      ? (() => {
          const orderWithoutGroup = table.metadata!.columnOrder!.filter(
            (id) => !groupColIdsBefore.has(id)
          )
          const firstGroupOrderIdx = table.metadata!.columnOrder!.findIndex((id) =>
            groupColIdsBefore.has(id)
          )
          const orderAnchor =
            firstGroupOrderIdx === -1 ? orderWithoutGroup.length : firstGroupOrderIdx
          return [
            ...orderWithoutGroup.slice(0, orderAnchor),
            ...orderedGroupColIds,
            ...orderWithoutGroup.slice(orderAnchor),
          ]
        })()
      : undefined

    assertValidSchema(updatedSchema, updatedColumnOrder)

    const updatedMetadata: TableMetadata | null =
      updatedColumnOrder && table.metadata
        ? { ...table.metadata, columnOrder: updatedColumnOrder }
        : table.metadata
          ? { ...table.metadata }
          : null

    const now = new Date()
    await trx
      .update(userTableDefinitions)
      .set({ schema: updatedSchema, metadata: updatedMetadata, updatedAt: now })
      .where(eq(userTableDefinitions.id, data.tableId))

    logger.info(
      `[${requestId}] Added output "${columnName}" (${newColDef.type}) to workflow group "${data.groupId}" in table ${data.tableId}`
    )

    const updatedTable: TableDefinition = {
      ...table,
      schema: updatedSchema,
      metadata: updatedMetadata,
      updatedAt: now,
    }
    return { updatedTable, newOutput }
  })

  // Backfill from saved execution logs — same flow `updateWorkflowGroup`
  // uses for added outputs. Reads each row's saved trace spans for the
  // group's executionId and writes the new output's value back. Existing
  // rows that have hand-edited values are left alone (overwrite: false).
  // Cheap compared to re-running the workflow on every row, which is what
  // an earlier version of this code did — that mistakenly fanned out N
  // workflow-group-cell jobs and burned compute the user didn't ask for.
  // Small tables backfill inline; large ones run as a background job.
  // Lazy import: backfill-runner closes a cycle back to this module.
  try {
    const { maybeBackfillGroupOutputs } = await import('@/lib/table/backfill-runner')
    await maybeBackfillGroupOutputs({
      table: updatedTable,
      groupId: data.groupId,
      outputs: [newOutput],
      overwrite: false,
      requestId,
      actorUserId: data.actorUserId,
    })
  } catch (err) {
    logger.warn(
      `[${requestId}] Backfill from execution logs failed for ${data.tableId} group ${data.groupId} after adding output "${newOutput.columnName}":`,
      err
    )
  }

  return updatedTable
}

/**
 * Removes a single output from a workflow group. Drops the bound column and
 * strips the value from every row's `data` JSONB. If the output is the
 * group's last, the empty group is left in place — drop it explicitly with
 * `deleteWorkflowGroup` if needed.
 */
export async function deleteWorkflowGroupOutput(
  data: { tableId: string; groupId: string; columnName: string },
  requestId: string
): Promise<TableDefinition> {
  return withLockedTable(data.tableId, async (table, trx) => {
    const schema = table.schema
    const groups = schema.workflowGroups ?? []
    const groupIndex = groups.findIndex((g) => g.id === data.groupId)
    if (groupIndex === -1) {
      throw new Error(`Workflow group "${data.groupId}" not found`)
    }
    const group = groups[groupIndex]
    // `data.columnName` may be a column id (first-party) or display name
    // (mothership/legacy); resolve to the stable id used everywhere below.
    const targetColumn = schema.columns.find((c) => columnMatchesRef(c, data.columnName))
    const columnId = targetColumn ? getColumnId(targetColumn) : data.columnName
    if (!group.outputs.some((o) => o.columnName === columnId)) {
      throw new Error(
        `Workflow group "${data.groupId}" has no output bound to column "${data.columnName}"`
      )
    }

    const updatedGroup: WorkflowGroup = {
      ...group,
      outputs: group.outputs.filter((o) => o.columnName !== columnId),
    }
    const nextGroups = groups.map((g, i) => (i === groupIndex ? updatedGroup : g))
    const nextColumns = schema.columns.filter((c) => getColumnId(c) !== columnId)
    const updatedSchema: TableSchema = {
      ...schema,
      columns: nextColumns,
      workflowGroups: nextGroups,
    }

    const updatedColumnOrder = table.metadata?.columnOrder?.filter((id) => id !== columnId)
    assertValidSchema(updatedSchema, updatedColumnOrder)

    const updatedMetadata: TableMetadata | null =
      updatedColumnOrder && table.metadata
        ? { ...table.metadata, columnOrder: updatedColumnOrder }
        : table.metadata
          ? { ...table.metadata }
          : null

    const now = new Date()
    await setTableTxTimeouts(trx, { statementMs: 60_000 })
    await trx
      .update(userTableDefinitions)
      .set({ schema: updatedSchema, metadata: updatedMetadata, updatedAt: now })
      .where(eq(userTableDefinitions.id, data.tableId))
    await trx.execute(
      sql`UPDATE user_table_rows SET data = data - ${columnId}::text WHERE table_id = ${data.tableId} AND data ? ${columnId}::text`
    )

    logger.info(
      `[${requestId}] Removed output "${data.columnName}" from workflow group "${data.groupId}" in table ${data.tableId}`
    )

    return { ...table, schema: updatedSchema, metadata: updatedMetadata, updatedAt: now }
  })
}

/**
 * Removes a workflow group plus all its output columns. Also strips the
 * group's `executions[groupId]` entry from every row.
 */
export async function deleteWorkflowGroup(
  data: DeleteWorkflowGroupData,
  requestId: string
): Promise<TableDefinition> {
  return withLockedTable(data.tableId, async (table, trx) => {
    const schema = table.schema
    const groups = schema.workflowGroups ?? []
    const group = groups.find((g) => g.id === data.groupId)
    if (!group) {
      throw new Error(`Workflow group "${data.groupId}" not found`)
    }

    const removedColumnIds = new Set(group.outputs.map((o) => o.columnName))
    // Removed group's output columns may be referenced as deps by sibling groups.
    // Strip those refs so we don't leave dangling-column deps behind.
    const nextGroups = groups
      .filter((g) => g.id !== data.groupId)
      .map((g) => stripGroupDeps(g, removedColumnIds))
    const updatedSchema: TableSchema = {
      ...schema,
      columns: schema.columns.filter((c) => !removedColumnIds.has(getColumnId(c))),
      workflowGroups: nextGroups,
    }
    const updatedColumnOrder = table.metadata?.columnOrder?.filter(
      (id) => !removedColumnIds.has(id)
    )
    assertValidSchema(updatedSchema, updatedColumnOrder)

    const updatedMetadata: TableMetadata | null =
      updatedColumnOrder && table.metadata
        ? { ...table.metadata, columnOrder: updatedColumnOrder }
        : table.metadata
          ? { ...table.metadata }
          : null

    const now = new Date()
    await setTableTxTimeouts(trx, { statementMs: 60_000 })
    await trx
      .update(userTableDefinitions)
      .set({ schema: updatedSchema, metadata: updatedMetadata, updatedAt: now })
      .where(eq(userTableDefinitions.id, data.tableId))
    for (const id of removedColumnIds) {
      await trx.execute(
        sql`UPDATE user_table_rows SET data = data - ${id}::text WHERE table_id = ${data.tableId} AND data ? ${id}::text`
      )
    }
    await stripGroupExecutions(trx, data.tableId, [data.groupId])

    logger.info(
      `[${requestId}] Deleted workflow group "${data.groupId}" from table ${data.tableId}`
    )

    return {
      ...table,
      schema: updatedSchema,
      metadata: updatedMetadata,
      updatedAt: now,
    }
  })
}

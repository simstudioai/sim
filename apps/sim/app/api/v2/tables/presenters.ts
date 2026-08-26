import type { V2TableRunDispatch } from '@/lib/api/contracts/v2/tables'
import { buildNameById, remapGroupColumnRefs } from '@/lib/table/column-keys'
import type { DispatchRow } from '@/lib/table/dispatcher'
import { type TableExportRecord, toV2TableExport } from '@/lib/table/orchestration/export-resource'
import {
  type CreateTableImportResult,
  type TableImportResource,
  toV2CreateTableImport,
  toV2TableImport,
} from '@/lib/table/orchestration/import-resource'
import type { TableSchema, WorkflowGroup } from '@/lib/table/types'

export function presentV2CreateTableImport(result: CreateTableImportResult) {
  return { data: toV2CreateTableImport(result) }
}

export function presentV2TableImport(record: TableImportResource) {
  return { data: toV2TableImport(record) }
}

export function presentV2TableExport(record: TableExportRecord, queued = false) {
  return { data: toV2TableExport(record, queued) }
}

/**
 * A workflow group with its column references presented as column **names**.
 *
 * Groups store `outputs[].columnName`, `dependencies.columns[]`, and
 * `inputMappings[].columnName` as stable column **ids** so a rename cannot
 * orphan them — but the field is named for, documented as, and accepted on
 * create as a name, and every other v2 row surface is keyed by name. Reading
 * back a `col_…` id under `columnName` meant a group could not be round-tripped
 * into a create, and the value did not correspond to anything else the caller
 * could see. `remapGroupColumnRefs` is the same rewrite the write path uses,
 * driven by the inverse map; a ref naming no current column is left as-is, so a
 * legacy name-keyed group and a ref to a since-deleted column both survive.
 */
export function presentV2WorkflowGroup(group: WorkflowGroup, schema: TableSchema): WorkflowGroup {
  return remapGroupColumnRefs(group, buildNameById(schema))
}

/**
 * Projects one stored dispatch onto the public resource.
 *
 * The stored `cursor` (highest row position already enqueued), `requestId`, and
 * `triggeredByUserId` stay internal: the first is a scheduler position that a
 * field of that name on a v2 resource would be mistaken for a pagination token,
 * and the other two name internal identities. Every published status is
 * reachable, including the two terminal ones — this resource exists to be
 * polled until a run settles.
 */
export function presentV2TableDispatch(dispatch: DispatchRow): V2TableRunDispatch {
  return {
    id: dispatch.id,
    tableId: dispatch.tableId,
    workspaceId: dispatch.workspaceId,
    /**
     * The column stores `cancelled`; the surface publishes `canceled`, which is
     * how table imports, exports, and job state already spell it. Mapping here
     * keeps one spelling on the wire without renaming a stored value.
     */
    status: dispatch.status === 'cancelled' ? 'canceled' : dispatch.status,
    mode: dispatch.mode,
    /**
     * A select-all dispatch carries a compiled filter and an exclusion set
     * instead of a row list, and the dispatcher runs both. Publishing only
     * `groupIds` and `rowIds` described a filtered run exactly like an
     * unfiltered one, so `rowIds: undefined` read as "every eligible row" for
     * two scopes that target very different sets — and `POST` on this same path
     * accepts `filter` and `excludeRowIds`, so a caller could create a scope
     * this resource then denied having.
     *
     * The filter itself stays unpublished, with the scheduler `cursor` and the
     * internal identities: it is stored compiled, in a different grammar from
     * the predicate the request was written in, so returning it would publish
     * an internal artifact under a name callers would read as their own input.
     * `selectAll` names the distinction without claiming to reproduce it.
     */
    scope: {
      groupIds: dispatch.scope.groupIds,
      ...(dispatch.scope.rowIds ? { rowIds: dispatch.scope.rowIds } : {}),
      ...(dispatch.scope.filter ? { selectAll: true as const } : {}),
      ...(dispatch.scope.excludeRowIds?.length
        ? { excludeRowIds: dispatch.scope.excludeRowIds }
        : {}),
    },
    limit: dispatch.limit,
    processedCount: dispatch.processedCount,
    isManualRun: dispatch.isManualRun,
    requestedAt: dispatch.requestedAt.toISOString(),
    completedAt: dispatch.completedAt?.toISOString() ?? null,
    canceledAt: dispatch.cancelledAt?.toISOString() ?? null,
  }
}

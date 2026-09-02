/**
 * Server-only half of the column-type registry: the cell rewrites that run
 * inside the retype transaction.
 *
 * Kept out of `registry.ts` because these need a drizzle transaction, and the
 * tables grid imports that module. Mirrors `connectors/registry.server.ts`.
 *
 * A migration is keyed by *direction*: `migrateCellsTo` runs when a column is
 * converted into the type, `migrateCellsFrom` when it is converted out of it.
 * `select` needs both — its cells store opaque option ids that mean nothing
 * under any other type. `currency` needs only the inbound one.
 */

import { userTableDefinitions, userTableRows } from '@sim/db/schema'
import { formatQuotedNameList } from '@sim/utils/string'
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbOrTx } from '@/lib/db/types'
import { COLUMN_TYPE_REGISTRY } from '@/lib/table/column-types/registry'
import type { ColumnType } from '@/lib/table/column-types/types'
import type {
  ColumnCellMigration,
  ColumnTypeServerEntry,
} from '@/lib/table/column-types/types.server'
import type { DbTransaction } from '@/lib/table/planner'
import { updateTableRowsWithDerivedSecretProvenance } from '@/lib/table/rows/secret-provenance'
import type { ColumnDefinition, JsonValue, SelectOption, TableSchema } from '@/lib/table/types'

/**
 * Rewrites a column's cells from stored option **ids** to option **names**, for
 * a column that is ceasing to be a `select`. A multi cell joins comma-separated
 * — the same shape it exports as.
 *
 * An id whose option no longer exists becomes null, matching
 * {@link selectValueForConversion}, which is what the compatibility check ran
 * on. Passing it through instead would leave an opaque `opt_…` in a typed cell
 * the check had already accounted as empty.
 *
 * Set-based: one statement per stored shape, driven by a jsonb id→name map, so
 * cost is independent of row count.
 */
async function migrateSelectCellsToNames(
  trx: DbTransaction,
  tableId: string,
  workspaceId: string,
  columnKey: string,
  options: SelectOption[]
): Promise<void> {
  const nameById = JSON.stringify(Object.fromEntries(options.map((o) => [o.id, o.name])))
  await updateTableRowsWithDerivedSecretProvenance(trx, {
    rowWhere: and(
      eq(userTableRows.tableId, tableId),
      eq(userTableRows.workspaceId, workspaceId),
      sql`jsonb_typeof(${userTableRows.data}->${columnKey}::text) = 'string'`
    )!,
    transformation: {
      mode: 'preserve',
      dataExpression: sql`jsonb_set(${userTableRows.data}, ARRAY[${columnKey}::text],
        COALESCE(
          ${nameById}::jsonb -> (${userTableRows.data}->>${columnKey}::text),
          'null'::jsonb
        ))`,
    },
  })
  await updateTableRowsWithDerivedSecretProvenance(trx, {
    rowWhere: and(
      eq(userTableRows.tableId, tableId),
      eq(userTableRows.workspaceId, workspaceId),
      sql`jsonb_typeof(${userTableRows.data}->${columnKey}::text) = 'array'`
    )!,
    transformation: {
      mode: 'preserve',
      dataExpression: sql`jsonb_set(${userTableRows.data}, ARRAY[${columnKey}::text], COALESCE(to_jsonb((
        SELECT string_agg(${nameById}::jsonb ->> e.v, ', ' ORDER BY e.ord)
        FROM jsonb_array_elements_text(${userTableRows.data}->${columnKey}::text)
          WITH ORDINALITY AS e(v, ord)
        WHERE ${nameById}::jsonb ? e.v
      )), 'null'::jsonb))`,
    },
  })
}

/** Rows rewritten per statement, bounding the size of the jsonb map parameter. */
const COERCED_WRITE_BACK_BATCH_SIZE = 5000

/**
 * Writes back the values a conversion's coercion produced.
 *
 * A retype is allowed exactly when the target type's `coerce` accepts the
 * value, and `coerce` frequently *transforms* it — an epoch number becomes an
 * ISO date, `$1,234.56` becomes `1234.56`. Without this, the cell keeps its old
 * bytes under the new type, and since filters and sorts apply the type's
 * `jsonbCast` to whatever is stored, an epoch left in a `date` column makes
 * `::timestamptz` fail on EVERY query against that column.
 *
 * The values arrive already computed (the compatibility scan derived them), so
 * this is purely the write. It cannot be expressed set-based — the coercions
 * are JS, and a naive SQL equivalent would mangle exactly the inputs they
 * disambiguate — so the map is folded into one statement per batch.
 */
export async function writeBackCoercedCells(
  trx: DbTransaction,
  tableId: string,
  workspaceId: string,
  columnKey: string,
  valueByRowId: ReadonlyMap<string, JsonValue>
): Promise<void> {
  if (valueByRowId.size === 0) return

  const entries = [...valueByRowId]
  for (let start = 0; start < entries.length; start += COERCED_WRITE_BACK_BATCH_SIZE) {
    const batch = JSON.stringify(
      Object.fromEntries(entries.slice(start, start + COERCED_WRITE_BACK_BATCH_SIZE))
    )
    await updateTableRowsWithDerivedSecretProvenance(trx, {
      rowWhere: and(
        eq(userTableRows.tableId, tableId),
        eq(userTableRows.workspaceId, workspaceId),
        sql`${batch}::jsonb ? ${userTableRows.id}`
      )!,
      transformation: {
        mode: 'preserve',
        dataExpression: sql`jsonb_set(
          ${userTableRows.data},
          ARRAY[${columnKey}::text],
          ${batch}::jsonb -> ${userTableRows.id}
        )`,
      },
    })
  }
}

/**
 * Rewrites a column's cells into the canonical `select` storage shape: the
 * option **id**, wrapped in an array when the column is `multiple`.
 *
 * Needed in both directions of a select change. Converting *to* select, cells
 * hold option names (that is what made them compatible) but every reader —
 * pills, filters, exports — resolves by id. Toggling single→multi, cells hold a
 * scalar id while multi filters compile to array containment, which a scalar
 * never matches. Either way the cell silently drops out until it is re-edited.
 *
 * Scalar cells count, not just strings: `resolveSelectOptionId` stringifies a
 * number or boolean before matching, so a `number` column whose values equal
 * option NAMES passes the compatibility gate. Matching only `jsonb_typeof =
 * 'string'` left those cells as raw numbers inside a select column, where they
 * render as nothing and fail option membership on the next write. `data->>key`
 * yields the text form for every scalar, so one widened predicate covers them.
 *
 * The map keys ids, names, and lower-cased names — ids so re-running is a no-op,
 * lower-cased names because `resolveSelectOptionId` accepts a case-mismatched
 * name and a cell that passed that check must actually migrate. Duplicate option
 * names are rejected case-insensitively at validation, so the folded key is
 * unambiguous; lookups still try the exact form first to preserve its precedence.
 */
async function migrateCellsToSelectIds(
  trx: DbTransaction,
  tableId: string,
  workspaceId: string,
  columnKey: string,
  options: SelectOption[],
  multiple: boolean
): Promise<void> {
  // Ids are written last so an id always outranks any option's name, matching
  // `resolveSelectOptionId`'s id-before-name precedence. A single flat pass
  // would let a later option whose *name* equals an earlier option's *id*
  // overwrite that id entry and repoint its cells at the wrong option.
  // A Map, not plain-object assignment: an option named `__proto__` would set
  // the prototype instead of an own key and drop out of the serialized map.
  const refs = new Map<string, string>()
  for (const o of options) {
    refs.set(o.name.toLowerCase(), o.id)
    refs.set(o.name, o.id)
  }
  for (const o of options) {
    refs.set(o.id, o.id)
  }
  const idByRef = JSON.stringify(Object.fromEntries(refs))

  if (multiple) {
    // A string cell reaching a multi target is either one option name or the
    // comma-joined form a multiselect converts to text as. Try the whole string
    // first so an option whose own name contains a comma still wins, then split
    // — mirroring `splitMultiSelectInput` on the write path, including its
    // first-occurrence dedup.
    await updateTableRowsWithDerivedSecretProvenance(trx, {
      rowWhere: and(
        eq(userTableRows.tableId, tableId),
        eq(userTableRows.workspaceId, workspaceId),
        sql`jsonb_typeof(${userTableRows.data}->${columnKey}::text) IN ('string', 'number', 'boolean')`
      )!,
      transformation: {
        mode: 'preserve',
        dataExpression: sql`jsonb_set(${userTableRows.data}, ARRAY[${columnKey}::text],
          CASE WHEN ${userTableRows.data}->>${columnKey}::text = '' THEN '[]'::jsonb
               WHEN COALESCE(${idByRef}::jsonb -> (${userTableRows.data}->>${columnKey}::text), ${idByRef}::jsonb -> lower(${userTableRows.data}->>${columnKey}::text)) IS NOT NULL
                 THEN jsonb_build_array(COALESCE(${idByRef}::jsonb -> (${userTableRows.data}->>${columnKey}::text), ${idByRef}::jsonb -> lower(${userTableRows.data}->>${columnKey}::text)))
               ELSE COALESCE((
                 SELECT jsonb_agg(v ORDER BY ord) FROM (
                   SELECT COALESCE(${idByRef}::jsonb -> btrim(part), ${idByRef}::jsonb -> lower(btrim(part)), to_jsonb(btrim(part))) AS v,
                          min(o) AS ord
                   FROM unnest(string_to_array(${userTableRows.data}->>${columnKey}::text, ',')) WITH ORDINALITY AS u(part, o)
                   WHERE btrim(part) <> ''
                   GROUP BY 1
                 ) d), '[]'::jsonb)
          END)`,
      },
    })
    await updateTableRowsWithDerivedSecretProvenance(trx, {
      rowWhere: and(
        eq(userTableRows.tableId, tableId),
        eq(userTableRows.workspaceId, workspaceId),
        sql`jsonb_typeof(${userTableRows.data}->${columnKey}::text) = 'array'`
      )!,
      transformation: {
        mode: 'preserve',
        dataExpression: sql`jsonb_set(${userTableRows.data}, ARRAY[${columnKey}::text], COALESCE((
          SELECT jsonb_agg(COALESCE(${idByRef}::jsonb -> e.v, ${idByRef}::jsonb -> lower(e.v), to_jsonb(e.v)) ORDER BY e.ord)
          FROM jsonb_array_elements_text(${userTableRows.data}->${columnKey}::text)
            WITH ORDINALITY AS e(v, ord)
        ), '[]'::jsonb))`,
      },
    })
    return
  }

  // A cleared cell is stored as '' — compatibility lets it through, so it has
  // to land as null rather than an '' that fails option membership on the next
  // write.
  await updateTableRowsWithDerivedSecretProvenance(trx, {
    rowWhere: and(
      eq(userTableRows.tableId, tableId),
      eq(userTableRows.workspaceId, workspaceId),
      sql`jsonb_typeof(${userTableRows.data}->${columnKey}::text) IN ('string', 'number', 'boolean')`
    )!,
    transformation: {
      mode: 'preserve',
      dataExpression: sql`jsonb_set(${userTableRows.data}, ARRAY[${columnKey}::text],
        CASE WHEN ${userTableRows.data}->>${columnKey}::text = '' THEN 'null'::jsonb
             ELSE COALESCE(
               ${idByRef}::jsonb -> (${userTableRows.data}->>${columnKey}::text),
               ${idByRef}::jsonb -> lower(${userTableRows.data}->>${columnKey}::text),
               ${userTableRows.data}->${columnKey}::text
             )
        END)`,
    },
  })
  // Compatibility already rejected multi-valued cells for a single target, so
  // any array here holds at most one option.
  await updateTableRowsWithDerivedSecretProvenance(trx, {
    rowWhere: and(
      eq(userTableRows.tableId, tableId),
      eq(userTableRows.workspaceId, workspaceId),
      sql`jsonb_typeof(${userTableRows.data}->${columnKey}::text) = 'array'`
    )!,
    transformation: {
      mode: 'preserve',
      dataExpression: sql`jsonb_set(${userTableRows.data}, ARRAY[${columnKey}::text],
        COALESCE(
          ${idByRef}::jsonb -> (${userTableRows.data}->${columnKey}::text->>0),
          ${idByRef}::jsonb -> lower(${userTableRows.data}->${columnKey}::text->>0),
          ${userTableRows.data}->${columnKey}::text->0,
          'null'::jsonb
        ))`,
    },
  })
}

/**
 * Every column type plus its migrations. The `Record<ColumnType, …>`
 * annotation is the same completeness gate the client-safe registry uses: a
 * new type will not compile until it appears here too.
 */
export const COLUMN_TYPE_SERVER_REGISTRY: Record<ColumnType, ColumnTypeServerEntry> = {
  string: COLUMN_TYPE_REGISTRY.string,
  number: COLUMN_TYPE_REGISTRY.number,
  boolean: COLUMN_TYPE_REGISTRY.boolean,
  date: COLUMN_TYPE_REGISTRY.date,
  ttl: COLUMN_TYPE_REGISTRY.ttl,
  json: COLUMN_TYPE_REGISTRY.json,
  select: {
    ...COLUMN_TYPE_REGISTRY.select,
    migrateCellsTo: ({ trx, tableId, workspaceId, columnKey, target }) =>
      migrateCellsToSelectIds(
        trx,
        tableId,
        workspaceId,
        columnKey,
        target.options ?? [],
        !!target.multiple
      ),
    migrateCellsFrom: ({ trx, tableId, workspaceId, columnKey, previous }) =>
      migrateSelectCellsToNames(trx, tableId, workspaceId, columnKey, previous.options ?? []),
  },
  currency: COLUMN_TYPE_REGISTRY.currency,
  reference: {
    ...COLUMN_TYPE_REGISTRY.reference,
    referencedTableIds: (column) =>
      typeof column.referenceTableId === 'string' ? [column.referenceTableId] : [],
    remapReferencedTableIds: (column, tableIdMap) => {
      const referenceTableId = column.referenceTableId
      if (typeof referenceTableId !== 'string') return column
      const remappedTableId = tableIdMap.get(referenceTableId)
      return remappedTableId && remappedTableId !== referenceTableId
        ? { ...column, referenceTableId: remappedTableId }
        : column
    },
  },
}

export function collectColumnReferencedTableIds(columns: readonly ColumnDefinition[]): string[] {
  return [
    ...new Set(
      columns.flatMap(
        (column) => COLUMN_TYPE_SERVER_REGISTRY[column.type].referencedTableIds?.(column) ?? []
      )
    ),
  ]
}

export interface ActiveTableReferenceBlocker {
  targetTableId: string
  targetTableName: string
  targetFolderId: string | null
  referencingTableName: string
}

export function tableReferenceBlockerMessage(
  targetTableName: string,
  referencingTableNames: readonly string[]
): string {
  const uniqueNames = [...new Set(referencingTableNames)].sort()
  const blockerLabel = uniqueNames.length === 1 ? 'table' : 'tables'
  const columnLabel = uniqueNames.length === 1 ? 'column' : 'columns'
  return `Cannot delete table "${targetTableName}" because it is referenced by ${blockerLabel} ${formatQuotedNameList(uniqueNames, uniqueNames.length)}. Remove the reference ${columnLabel} first.`
}

/**
 * Finds active tables that point at any active table in the requested deletion selection.
 *
 * The table service caps the number of tables in a workspace, so reading the active definitions
 * once is bounded and cheaper than issuing one JSONB search per table in a folder cascade.
 * Reference ownership still comes from the server column-type registry; this function does not
 * duplicate knowledge of the `reference` column shape.
 */
export async function findActiveTableReferenceBlockers(
  executor: DbOrTx,
  workspaceId: string,
  selection: { tableIds?: readonly string[]; folderIds?: ReadonlySet<string> }
): Promise<ActiveTableReferenceBlocker[]> {
  const selectedTableIds = new Set(selection.tableIds)
  const selectedFolderIds = selection.folderIds ?? new Set<string>()
  if (selectedTableIds.size === 0 && selectedFolderIds.size === 0) return []

  const activeTables = await executor
    .select({
      id: userTableDefinitions.id,
      name: userTableDefinitions.name,
      folderId: userTableDefinitions.folderId,
      schema: userTableDefinitions.schema,
    })
    .from(userTableDefinitions)
    .where(
      and(
        eq(userTableDefinitions.workspaceId, workspaceId),
        isNull(userTableDefinitions.archivedAt)
      )
    )

  const selectedTargets = new Map(
    activeTables
      .filter(
        (table) =>
          selectedTableIds.has(table.id) ||
          (table.folderId !== null && selectedFolderIds.has(table.folderId))
      )
      .map((table) => [table.id, table])
  )
  if (selectedTargets.size === 0) return []

  const blockers: ActiveTableReferenceBlocker[] = []
  for (const referencingTable of activeTables) {
    if (selectedTargets.has(referencingTable.id)) continue
    for (const referencedTableId of collectColumnReferencedTableIds(
      (referencingTable.schema as TableSchema).columns
    )) {
      const target = selectedTargets.get(referencedTableId)
      if (!target) continue
      blockers.push({
        targetTableId: target.id,
        targetTableName: target.name,
        targetFolderId: target.folderId,
        referencingTableName: referencingTable.name,
      })
    }
  }

  return blockers.sort(
    (left, right) =>
      left.targetTableName.localeCompare(right.targetTableName) ||
      left.referencingTableName.localeCompare(right.referencingTableName)
  )
}

export function remapColumnReferencedTableIds(
  columns: readonly ColumnDefinition[],
  tableIdMap: ReadonlyMap<string, string>
): ColumnDefinition[] {
  return columns.map(
    (column) =>
      COLUMN_TYPE_SERVER_REGISTRY[column.type].remapReferencedTableIds?.(column, tableIdMap) ??
      column
  )
}

/**
 * Validates every table ID referenced by column metadata in one query.
 *
 * This intentionally validates only the target table. Cell values remain
 * opaque row-ID strings and are never checked for existence.
 */
export async function assertColumnReferencesInWorkspace(
  trx: DbTransaction,
  workspaceId: string,
  columns: readonly ColumnDefinition[],
  options?: { allowedArchivedTableIds?: ReadonlySet<string> }
): Promise<void> {
  const referencedTableIds = collectColumnReferencedTableIds(columns)
  if (referencedTableIds.length === 0) return
  const allowedArchivedTableIds = referencedTableIds.filter((id) =>
    options?.allowedArchivedTableIds?.has(id)
  )
  const availableTarget =
    allowedArchivedTableIds.length > 0
      ? or(
          isNull(userTableDefinitions.archivedAt),
          inArray(userTableDefinitions.id, allowedArchivedTableIds)
        )
      : isNull(userTableDefinitions.archivedAt)

  const targets = await trx
    .select({ id: userTableDefinitions.id })
    .from(userTableDefinitions)
    .where(
      and(
        eq(userTableDefinitions.workspaceId, workspaceId),
        inArray(userTableDefinitions.id, referencedTableIds),
        availableTarget
      )
    )
    .for('key share')
  const foundIds = new Set(targets.map((target) => target.id))
  const missingId = referencedTableIds.find((id) => !foundIds.has(id))
  if (missingId) {
    throw new OrchestrationError(
      'not_found',
      `Reference table "${missingId}" not found in this workspace`
    )
  }
}

/** The inbound migration for a target type, if it has one. */
export function migrationTo(type: ColumnType): ColumnCellMigration | undefined {
  return COLUMN_TYPE_SERVER_REGISTRY[type]?.migrateCellsTo
}

/** The outbound migration for a source type, if it has one. */
export function migrationFrom(type: ColumnType): ColumnCellMigration | undefined {
  return COLUMN_TYPE_SERVER_REGISTRY[type]?.migrateCellsFrom
}

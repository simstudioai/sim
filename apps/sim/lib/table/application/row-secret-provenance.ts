import { type Principal, requirePrincipalSubjectUserId } from '@sim/auth/principal'
import { isPrivateSecretProvenanceScopeCompatible } from '@/lib/execution/durable-secret-provenance'
import { isPrivateSecretProvenanceBundleV1 } from '@/lib/execution/model-input-provenance'
import { buildIdByName } from '@/lib/table/column-keys'
import { createExactEmptyTableRowSecretProvenance } from '@/lib/table/rows/secret-provenance'
import { tableRowSecretProvenanceSelectionKey } from '@/lib/table/secret-provenance-selection'
import type { RowData, TableDefinition, TableRowSecretProvenanceWrite } from '@/lib/table/types'

/**
 * The private provenance envelope exactly as it arrived on the wire.
 *
 * A surface adapter can read the header and the payload field — that is
 * transport — but it cannot decide what the selections mean, because mapping a
 * caller's column key to the storage column id it certifies requires the
 * canonical schema. That resolution lives here, behind authorization, which is
 * what lets the row routes stop loading the table for themselves.
 */
export type TableRowProvenanceEnvelope = { kind: 'none' } | { kind: 'bundle'; value: unknown }

/** Raised when an envelope does not authenticate against the canonical table. */
export class TableRowProvenanceError extends Error {
  constructor(message = 'Invalid table row secret provenance') {
    super(message)
    this.name = 'TableRowProvenanceError'
  }
}

/**
 * Storage column id for each key the caller wrote, or `null` where the key names
 * no column and is therefore never persisted.
 *
 * This must mirror {@link rowDataToStorage} exactly, or a cell could be written
 * with no provenance recorded under a `complete` stamp. The two wires differ in
 * what they do with an unrecognised key: the name path drops it, so it gets
 * `null`; the id path stores what it is given, so every key it sends is a
 * storage key and none of them is `null`.
 */
function storageKeyByWireKey(
  row: RowData,
  table: TableDefinition,
  keying: 'names' | 'ids'
): Map<string, string | null> {
  const wireKeys = Object.keys(row)
  if (keying === 'ids') return new Map(wireKeys.map((key) => [key, key]))
  const idByName = buildIdByName(table.schema)
  return new Map(wireKeys.map((key) => [key, idByName.get(key) ?? null]))
}

/**
 * What a write should stamp on its provenance sidecar.
 *
 * `undefined` is not "nothing to record" — it means *deliberately untracked*, the
 * legacy protocol for an internal caller that sent no envelope. Defaulting it to
 * an exact-empty stamp would certify "this write introduced no secrets" on a
 * runtime write that may well have introduced some, so the two must stay
 * distinguishable all the way to the sidecar.
 */
export interface ResolvedRowWriteProvenance {
  stamps: Array<TableRowSecretProvenanceWrite | undefined>
}

/**
 * Resolves a wire envelope into per-row provenance stamps against the canonical
 * table.
 *
 * An interactive caller (session) certifies exact-empty over the storage columns
 * its write actually persists. An internal execution may submit an encrypted
 * bundle, which must name exactly the columns the write touched and must carry a
 * scope this principal is allowed to read. Anything else fails closed.
 */
export function resolveRowWriteProvenance(options: {
  envelope: TableRowProvenanceEnvelope
  principal: Principal
  workspaceId: string
  table: TableDefinition
  keying: 'names' | 'ids'
  wireRows: readonly RowData[]
  storageRows: readonly RowData[]
}): ResolvedRowWriteProvenance {
  const { envelope, principal, table, keying, wireRows, storageRows } = options
  const isDelegated = principal.kind !== 'session'

  if (envelope.kind === 'none') {
    // An internal caller that sent nothing stays untracked, as it always has.
    if (isDelegated) return { stamps: wireRows.map(() => undefined) }
    return { stamps: storageRows.map((row) => createExactEmptyTableRowSecretProvenance(row)) }
  }

  if (!isDelegated || !isPrivateSecretProvenanceBundleV1(envelope.value)) {
    throw new TableRowProvenanceError()
  }
  const bundle = envelope.value

  const columnIdBySelectionKey = new Map<string, string | null>()
  const rowKeyBySelectionKey = new Map<string, number>()
  wireRows.forEach((row, rowIndex) => {
    const storageKeys = storageKeyByWireKey(row, table, keying)
    for (const wireKey of Object.keys(row)) {
      const selectionKey = tableRowSecretProvenanceSelectionKey(rowIndex, wireKey)
      columnIdBySelectionKey.set(selectionKey, storageKeys.get(wireKey) ?? null)
      rowKeyBySelectionKey.set(selectionKey, rowIndex)
    }
  })

  // A complete bundle must account for every cell the write touched, and only
  // those — otherwise a caller could certify a column it never wrote.
  if (
    bundle.complete &&
    (bundle.selections.length !== columnIdBySelectionKey.size ||
      bundle.selections.some((selection) => !columnIdBySelectionKey.has(selection.key)))
  ) {
    throw new TableRowProvenanceError()
  }

  if (!bundle.complete) {
    return { stamps: wireRows.map(() => ({ complete: false, columns: {} })) }
  }

  const stamps: TableRowSecretProvenanceWrite[] = wireRows.map(() => ({
    complete: true,
    columns: {},
  }))
  const subjectUserId = requirePrincipalSubjectUserId(principal)
  for (const selection of bundle.selections) {
    const rowIndex = rowKeyBySelectionKey.get(selection.key)
    if (
      rowIndex === undefined ||
      !isPrivateSecretProvenanceScopeCompatible(selection.provenance.scope, {
        userId: subjectUserId,
        workspaceId: options.workspaceId,
      })
    ) {
      throw new TableRowProvenanceError()
    }
    const columnId = columnIdBySelectionKey.get(selection.key)
    if (columnId === null || columnId === undefined) continue
    if (Object.hasOwn(stamps[rowIndex].columns, columnId)) {
      throw new TableRowProvenanceError()
    }
    stamps[rowIndex].columns[columnId] = selection.provenance
  }
  return { stamps }
}

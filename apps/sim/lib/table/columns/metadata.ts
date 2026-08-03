/**
 * Boundary checks for a column-metadata update, shared by both column routes
 * and the copilot table tool.
 *
 * Each write below is its own locked transaction, so a request that is going to
 * fail deep in the service leaves earlier writes committed. These run before
 * any write at all — and they are registry-driven, so a new metadata key is
 * rejected on the wrong column type and validated on the right one without an
 * edit here.
 */

import {
  columnTypeById,
  metadataKeysIn,
  metadataWithoutClears,
  ownersOfMetadataKey,
  pickMetadata,
} from '@/lib/table/column-types'
import type { ColumnDefinition, ColumnMetadataPatch } from '@/lib/table/types'

/**
 * Rejects a metadata update that the column's resulting type cannot accept.
 *
 * Two failures, in order:
 *
 * 1. **Ownership** — a key the resulting type does not own. Gated on the type
 *    the column ENDS UP with, not on whether the type is changing: setting
 *    `precision` on a column that is simultaneously converting to `string` is
 *    the same hazard as setting it on an existing `string` column.
 * 2. **Value** — the owning type's own `validateDefinition`, run against the
 *    column as it would be after the write, so the message is the type's
 *    ("Use an ISO 4217 code, e.g. USD") rather than a generic one.
 *
 * @returns An error message, or null when the update is acceptable.
 */
export function validateMetadataUpdate(
  currentColumn: ColumnDefinition,
  resultingType: string | undefined,
  updates: ColumnMetadataPatch
): string | null {
  const { generic, dedicated } = metadataKeysIn(updates)
  const definition = columnTypeById(resultingType)

  for (const key of [...generic, ...dedicated]) {
    if (definition.ownedMetadata.includes(key)) continue
    const owners = ownersOfMetadataKey(key)
    return `Cannot set ${key} on column "${currentColumn.name}" of type "${resultingType}"${
      owners.length > 0
        ? ` — it applies to ${owners.map((o) => o.label).join(' and ')} columns`
        : ''
    }`
  }

  // Nothing to validate when the request carries no metadata. Running the
  // type's `validateDefinition` unconditionally would newly reject a bare
  // rename of an already-malformed column (a select with zero options), which
  // used to succeed and is not what this request is changing.
  if (generic.length === 0 && dedicated.length === 0) return null

  // Merge only the metadata keys — never the rest of the payload. Spreading
  // `updates` wholesale would fold in a pending `name`, so rejecting a bad
  // value would name the column by a rename that this very request is refusing
  // to perform.
  // A cleared key (`null`) validates as ABSENT — that is what the write will
  // leave behind — rather than as a null the type's validator has no arm for.
  const resulting: ColumnDefinition = {
    ...currentColumn,
    ...(resultingType ? { type: definition.id } : {}),
    ...metadataWithoutClears(pickMetadata(updates, [...generic, ...dedicated])),
  }
  for (const key of [...generic, ...dedicated]) {
    if (updates[key] === null) delete resulting[key]
  }
  const errors = definition.validateDefinition?.(resulting) ?? []
  return errors[0] ?? null
}

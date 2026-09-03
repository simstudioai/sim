/**
 * The server-only half of a column type: database-backed definition checks and
 * stored-cell rewrites for conversion into or out of the type.
 *
 * Separate from `types.ts` so the client-safe definition never references a
 * Drizzle transaction type. Mirrors `connectors/`'s `ConnectorMeta` /
 * `ConnectorConfig` split.
 */

import type { ColumnTypeDefinition } from '@/lib/table/column-types/types'
import type { DbTransaction } from '@/lib/table/planner'
import type { ColumnDefinition, JsonValue } from '@/lib/table/types'

export interface ColumnCellMigrationContext {
  trx: DbTransaction
  tableId: string
  workspaceId: string
  /** JSONB storage key for the column (its stable id). */
  columnKey: string
  /** The column definition as it was before the conversion. */
  previous: ColumnDefinition
  /** The column definition the table will end up with. */
  target: ColumnDefinition
  /**
   * Row id → replacement value, for types whose migration is computed in JS
   * during the compatibility scan rather than expressed set-based in SQL.
   */
  resolved: ReadonlyMap<string, JsonValue>
}

export type ColumnCellMigration = (context: ColumnCellMigrationContext) => Promise<void>

export interface ColumnTypeServerDefinition {
  /**
   * Table IDs named by this column's type-specific metadata. The server
   * registry uses this to validate cross-table references in one batch before
   * a schema is persisted. Omitted by types that do not reference tables.
   */
  readonly referencedTableIds?: (column: ColumnDefinition) => readonly string[]
  /**
   * Rewrites cells into this type's canonical storage shape when a column is
   * converted **to** it. Omitted when the stored bytes are already correct.
   */
  readonly migrateCellsTo?: ColumnCellMigration
  /**
   * Rewrites cells out of this type's storage shape when a column is converted
   * **away from** it. Needed when the stored value is meaningless under any
   * other type — a `select`'s option ids, for instance.
   */
  readonly migrateCellsFrom?: ColumnCellMigration
}

/** A column type plus its server-only migrations. */
export type ColumnTypeServerEntry = ColumnTypeDefinition & ColumnTypeServerDefinition

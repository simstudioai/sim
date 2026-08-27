import { generateShortId } from '@sim/utils/id'

const COLUMN_SUFFIX_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789_'

export type TableColumnType =
  | 'string'
  | 'number'
  | 'currency'
  | 'boolean'
  | 'date'
  | 'json'
  | 'select'

export interface TableColumnFixture {
  /** Stable storage key. Absent on legacy columns, where the name is the key. */
  id?: string
  name: string
  type: TableColumnType
  required?: boolean
  unique?: boolean
}

export interface TableRowFixture {
  id: string
  data: Record<string, unknown>
  position: number
  createdAt: string
  updatedAt: string
}

export interface TableColumnFactoryOptions {
  id?: string
  name?: string
  type?: TableColumnType
  required?: boolean
  unique?: boolean
}

export interface TableRowFactoryOptions {
  id?: string
  data?: Record<string, unknown>
  position?: number
  createdAt?: string
  updatedAt?: string
}

/**
 * Creates a table column fixture with sensible defaults.
 */
export function createTableColumn(options: TableColumnFactoryOptions = {}): TableColumnFixture {
  return {
    id: options.id,
    name: options.name ?? `column_${generateShortId(6, COLUMN_SUFFIX_ALPHABET)}`,
    type: options.type ?? 'string',
    required: options.required,
    unique: options.unique,
  }
}

/**
 * Creates a table row fixture with sensible defaults.
 */
export function createTableRow(options: TableRowFactoryOptions = {}): TableRowFixture {
  const timestamp = new Date().toISOString()

  return {
    id: options.id ?? `row_${generateShortId(8)}`,
    data: options.data ?? {},
    position: options.position ?? 0,
    createdAt: options.createdAt ?? timestamp,
    updatedAt: options.updatedAt ?? timestamp,
  }
}

/** Per-table mutation locks. All false means fully unlocked. */
export interface TableLocksFixture {
  schemaLocked: boolean
  insertLocked: boolean
  updateLocked: boolean
  deleteLocked: boolean
}

/**
 * Structural stand-in for `TableDefinition` in `apps/sim/lib/table/types.ts`.
 * Declared here rather than imported because `@sim/testing` must not depend on
 * `apps/*` (enforced by `scripts/check-monorepo-boundaries.ts`).
 */
export interface TableDefinitionFixture {
  id: string
  name: string
  description: string | null
  schema: { columns: TableColumnFixture[] }
  metadata: Record<string, unknown> | null
  rowCount: number
  maxRows: number
  workspaceId: string
  folderId?: string | null
  createdBy: string
  locks: TableLocksFixture
  archivedAt: Date | string | null
  createdAt: Date | string
  updatedAt: Date | string
}

export interface TableDefinitionFactoryOptions {
  id?: string
  name?: string
  description?: string | null
  /** Shorthand for `schema.columns` — the field call sites vary most. */
  columns?: TableColumnFixture[]
  metadata?: Record<string, unknown> | null
  rowCount?: number
  maxRows?: number
  workspaceId?: string
  folderId?: string | null
  createdBy?: string
  locks?: TableLocksFixture
  archivedAt?: Date | string | null
  createdAt?: Date | string
  updatedAt?: Date | string
}

const UNLOCKED_TABLE_LOCKS: TableLocksFixture = Object.freeze({
  schemaLocked: false,
  insertLocked: false,
  updateLocked: false,
  deleteLocked: false,
})

/**
 * Creates a table definition fixture with sensible defaults — the shape route
 * and service tests hand back from a table lookup.
 *
 * Callers most often override `columns` (the table's schema), `rowCount`,
 * `maxRows`, and `archivedAt`.
 */
export function createTableDefinition(
  options: TableDefinitionFactoryOptions = {}
): TableDefinitionFixture {
  const timestamp = new Date()

  return {
    id: options.id ?? 'tbl_1',
    name: options.name ?? 'People',
    description: options.description ?? null,
    schema: { columns: options.columns ?? [] },
    metadata: options.metadata ?? null,
    rowCount: options.rowCount ?? 0,
    maxRows: options.maxRows ?? 1_000_000,
    workspaceId: options.workspaceId ?? 'workspace-1',
    folderId: options.folderId,
    createdBy: options.createdBy ?? 'user-1',
    locks: options.locks ?? UNLOCKED_TABLE_LOCKS,
    archivedAt: options.archivedAt ?? null,
    createdAt: options.createdAt ?? timestamp,
    updatedAt: options.updatedAt ?? timestamp,
  }
}

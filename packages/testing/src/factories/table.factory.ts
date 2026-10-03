type TableColumnType = 'string' | 'number' | 'currency' | 'boolean' | 'date' | 'json' | 'select'

interface TableColumnFixture {
  /** Stable storage key. Absent on legacy columns, where the name is the key. */
  id?: string
  name: string
  type: TableColumnType
  required?: boolean
  unique?: boolean
}

/** Per-table mutation locks. All false means fully unlocked. */
interface TableLocksFixture {
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
interface TableDefinitionFixture {
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

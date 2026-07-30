import { generateShortId } from '@sim/utils/id'

const COLUMN_SUFFIX_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789_'

/**
 * Mirrors `apps/sim/lib/table/constants.ts`'s `COLUMN_TYPES` and must be kept
 * in sync with it by hand — `packages/*` can't import from `apps/*` (see
 * `.claude/rules/sim-architecture.md`), so there's no single source of truth
 * this can be derived from across the package boundary. This was previously
 * missing `select`.
 */
export type TableColumnType = 'string' | 'number' | 'boolean' | 'date' | 'json' | 'select'

export interface TableColumnFixture {
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

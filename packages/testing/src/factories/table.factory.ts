import { customAlphabet, nanoid } from 'nanoid'

export type TableColumnType = 'string' | 'number' | 'boolean' | 'date' | 'json'

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

const createTableColumnSuffix = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789_', 6)

/**
 * Creates a table column fixture with sensible defaults.
 */
export function createTableColumn(options: TableColumnFactoryOptions = {}): TableColumnFixture {
  return {
    name: options.name ?? `column_${createTableColumnSuffix()}`,
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
    id: options.id ?? `row_${nanoid(8)}`,
    data: options.data ?? {},
    position: options.position ?? 0,
    createdAt: options.createdAt ?? timestamp,
    updatedAt: options.updatedAt ?? timestamp,
  }
}

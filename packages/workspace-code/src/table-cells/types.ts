/** The value and column shapes the cell rules read: structurally the server's table types. */

/** A cell value: JSON, plus a `Date` a server caller may still hand in before it is stored. */
export type CellValue =
  | string
  | number
  | boolean
  | null
  | Date
  | CellValue[]
  | { [key: string]: CellValue }

/** A row by storage key (a column's id, or its name for a column without one). */
export type CellRow = Record<string, CellValue>

/** A `select` column's option: cells store its `id`, and a write may name it by `name`. */
export interface SelectOption {
  id: string
  name: string
}

/** A table column as the cell rules read it. */
export interface CellColumn {
  /** Storage key; a legacy column without one is keyed by `name`. */
  id?: string
  name: string
  type: string
  required?: boolean
  unique?: boolean
  /** A `select` column's options. */
  options?: SelectOption[]
  /** A `select` column whose cells hold several options. */
  multiple?: boolean
  /** A `currency` column's ISO 4217 code. */
  currencyCode?: string
}

/** A coercion's outcome: the value to store, or `ok: false` when no safe conversion exists. */
export type CoerceResult = { ok: true; value: CellValue } | { ok: false }

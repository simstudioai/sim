/**
 * Table declarations: `tables/<key>.ts` in a workspace source directory.
 *
 * ```ts
 * // @sim-sdk 1
 * import { column, defineTable } from '@sim/workflow-sdk/workspace'
 *
 * export default defineTable({
 *   name: 'leads',
 *   columns: {
 *     email: column.string({ required: true, unique: true }),
 *     status: column.select({ options: ['new', 'won', 'lost'] }),
 *     score: column.number(),
 *   },
 * })
 * ```
 *
 * A column's object key is its source key and stays bound to the stored column; `name` renames
 * the stored column while keeping its cells. Rows are never part of source.
 */
import type { Json } from '@sim/workflow-sdk'

declare const COLUMN: unique symbol

/** A declared column: the cell type `T` it holds and the name `N` it is stored under. */
export interface Column<T, N extends string | undefined = undefined> {
  readonly [COLUMN]: { value: T; name: N }
}

/** Options every column type takes. */
export interface ColumnOptions<N extends string | undefined = string | undefined> {
  /** The stored column name, when it differs from the column's key. */
  name?: N
  /** Every row must hold a value. */
  required?: boolean
  /** No two rows may hold the same value. */
  unique?: boolean
}

/** The column helpers: `column.string()`, `column.select({ options: [...] })`, … */
export declare const column: {
  string<const N extends string | undefined = undefined>(
    options?: ColumnOptions<N>
  ): Column<string, N>
  number<const N extends string | undefined = undefined>(
    options?: ColumnOptions<N>
  ): Column<number, N>
  /** A number shown as money; `currencyCode` is an ISO 4217 code (`USD` when omitted). */
  currency<const N extends string | undefined = undefined>(
    options?: ColumnOptions<N> & { currencyCode?: string }
  ): Column<number, N>
  boolean<const N extends string | undefined = undefined>(
    options?: ColumnOptions<N>
  ): Column<boolean, N>
  /** An ISO 8601 date or date-time string. */
  date<const N extends string | undefined = undefined>(
    options?: ColumnOptions<N>
  ): Column<string, N>
  /** A time to live: a date-time after which the row expires. */
  ttl<const N extends string | undefined = undefined>(options?: ColumnOptions<N>): Column<string, N>
  json<const N extends string | undefined = undefined>(options?: ColumnOptions<N>): Column<Json, N>
  /** One option per cell, from `options`. */
  select<const O extends readonly string[], const N extends string | undefined = undefined>(
    options: ColumnOptions<N> & { options: O; multiple?: false }
  ): Column<O[number], N>
  /** Several options per cell. */
  select<const O extends readonly string[], const N extends string | undefined = undefined>(
    options: ColumnOptions<N> & { options: O; multiple: true }
  ): Column<O[number][], N>
}

/** Any column, whatever it holds. */
type AnyColumn = Column<unknown, string | undefined>

/** A table declaration. */
export interface TableDeclaration<C extends Record<string, AnyColumn> = Record<string, AnyColumn>> {
  /** The table name: a letter or `_`, then letters, digits and `_`. */
  name: string
  description?: string
  /** The table folder path (`/reports`); the workspace root when omitted. */
  folder?: string
  columns: C
}

/** Declares a table. Its default export is the whole file. */
export declare function defineTable<const C extends Record<string, AnyColumn>>(
  table: TableDeclaration<C>
): TableDeclaration<C>

/** The stored name of column `K`: its `name` option, else its key. */
type StoredName<K, C> = C extends Column<unknown, infer N> ? ([N] extends [string] ? N : K) : K

/** A declared table's row, keyed by stored column name: `RowOf<typeof leads>`. */
export type RowOf<T> = T extends TableDeclaration<infer C>
  ? { [K in keyof C as StoredName<K, C[K]>]: C[K] extends Column<infer V, infer _N> ? V : never }
  : never

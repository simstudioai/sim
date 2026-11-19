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
 * the stored column while keeping its cells.
 *
 * Rows are part of source only when `rows` opts in: `tables/<key>.rows.jsonl` beside the
 * declaration holds one JSON object per line, keyed by column key (a select cell by option name).
 * `{ mode: 'seed' }` writes them into the table when an apply creates it (or adopts it empty);
 * `{ mode: 'managed', key }` keeps the table's rows equal to the file, each matched by the unique
 * `key` column (removing a row needs `--allow-delete`); a stored row whose `key` cell is empty is
 * left out of the file and kept as it is.
 */
import type { Json } from '@sim/workflow-sdk'

declare const COLUMN: unique symbol

/**
 * A declared column: the cell type `T` it holds, the name `N` it is stored under, and whether
 * every row must hold a value (`R`); a cell of a column that is not required may be empty (`null`).
 */
export interface Column<T, N extends string | undefined = undefined, R extends boolean = false> {
  readonly [COLUMN]: { value: T; name: N; required: R }
}

/** Options every column type takes. */
export interface ColumnOptions<
  N extends string | undefined = string | undefined,
  R extends boolean = boolean,
> {
  /** The stored column name, when it differs from the column's key. */
  name?: N
  /** Every row must hold a value. */
  required?: R
  /** No two rows may hold the same value. */
  unique?: boolean
}

/** The shared options a `select` column takes: never `unique`. */
type SelectOptions<N extends string | undefined, R extends boolean> = Omit<
  ColumnOptions<N, R>,
  'unique'
>

/** The column helpers: `column.string()`, `column.select({ options: [...] })`, … */
export declare const column: {
  string<const N extends string | undefined = undefined, const R extends boolean = false>(
    options?: ColumnOptions<N, R>
  ): Column<string, N, R>
  number<const N extends string | undefined = undefined, const R extends boolean = false>(
    options?: ColumnOptions<N, R>
  ): Column<number, N, R>
  /** A number shown as money; `currencyCode` is an ISO 4217 code (`USD` when omitted). */
  currency<const N extends string | undefined = undefined, const R extends boolean = false>(
    options?: ColumnOptions<N, R> & { currencyCode?: string }
  ): Column<number, N, R>
  boolean<const N extends string | undefined = undefined, const R extends boolean = false>(
    options?: ColumnOptions<N, R>
  ): Column<boolean, N, R>
  /** An ISO 8601 date or date-time string. */
  date<const N extends string | undefined = undefined, const R extends boolean = false>(
    options?: ColumnOptions<N, R>
  ): Column<string, N, R>
  /** A time to live: a date-time after which the row expires. A table holds at most one. */
  ttl<const N extends string | undefined = undefined, const R extends boolean = false>(
    options?: ColumnOptions<N, R>
  ): Column<string, N, R>
  json<const N extends string | undefined = undefined, const R extends boolean = false>(
    options?: ColumnOptions<N, R>
  ): Column<Json, N, R>
  /** One option per cell, from `options`. */
  select<
    const O extends readonly [string, ...string[]],
    const N extends string | undefined = undefined,
    const R extends boolean = false,
  >(options: SelectOptions<N, R> & { options: O; multiple?: false }): Column<O[number], N, R>
  /** Several options per cell. */
  select<
    const O extends readonly [string, ...string[]],
    const N extends string | undefined = undefined,
    const R extends boolean = false,
  >(options: SelectOptions<N, R> & { options: O; multiple: true }): Column<O[number][], N, R>
}

/** Any column, whatever it holds. */
type AnyColumn = Column<unknown, string | undefined, boolean>

/** A table declaration. */
export interface TableDeclaration<C extends Record<string, AnyColumn> = Record<string, AnyColumn>> {
  /** The table name: a letter or `_`, then letters, digits and `_`. */
  name: string
  description?: string
  /** The table folder path (`/reports`); the workspace root when omitted. */
  folder?: string
  columns: C
  /** Rows as source, from `tables/<key>.rows.jsonl`; omitted leaves rows out of source. */
  rows?: TableRows<keyof C & string>
}

/**
 * How a table's rows are source: `seed` rows go into the table once, when an apply creates it;
 * `managed` rows are the whole table, matched to stored rows by the unique `key` column.
 */
export type TableRows<K extends string = string> = { mode: 'seed' } | { mode: 'managed'; key: K }

/** Declares a table. Its default export is the whole file. */
export declare function defineTable<const C extends Record<string, AnyColumn>>(
  table: TableDeclaration<C>
): TableDeclaration<C>

/** The stored name of column `K`: its `name` option, else its key. */
type StoredName<K, C> = C extends Column<unknown, infer N, boolean>
  ? [N] extends [string]
    ? N
    : K
  : K

/** A cell of column `C`: its value, or `null` when the column is not required. */
type CellOf<C> = C extends Column<infer V, infer _N, infer R>
  ? R extends true
    ? V
    : V | null
  : never

/**
 * A declared table's row, keyed by stored column name: `RowOf<typeof leads>`. A cell of a column
 * that is not required may be `null`.
 */
export type RowOf<T> = T extends TableDeclaration<infer C>
  ? { [K in keyof C as StoredName<K, C[K]>]: CellOf<C[K]> }
  : never

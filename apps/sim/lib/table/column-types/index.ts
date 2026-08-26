/**
 * Column-type registry barrel.
 *
 * Client-safe — importing this never pulls `@sim/db` or `drizzle-orm`. Server
 * code that needs the retype cell migrations imports `registry.server` instead.
 *
 * Deliberately NOT re-exported from `@/lib/table`: 44 server modules import
 * that barrel, and routing this through it would pull `@sim/emcn/icons` into
 * every one of them. Import `@/lib/table/column-types` directly, the same way
 * `column-keys`, `constants`, and `dates` are already imported.
 */

export * from '@/lib/table/column-types/registry'
export type {
  CoerceResult,
  ColumnCellEditor,
  ColumnImportCoerceOptions,
  ColumnType,
  ColumnTypeDefinition,
  TypeSpecificColumnKey,
} from '@/lib/table/column-types/types'
export { TYPE_SPECIFIC_COLUMN_KEYS } from '@/lib/table/column-types/types'

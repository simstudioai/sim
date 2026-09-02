/**
 * Object kinds the editor's Snowflake pickers can enumerate.
 *
 * A leaf module on purpose: selector metadata is shared with client code, and
 * reading these values from `@/tools/snowflake/sql` would pull the whole
 * statement builder — and its transport dependencies — into the browser bundle
 * for the sake of a seven-element array.
 */
export const SNOWFLAKE_SELECTOR_KINDS = [
  'databases',
  'schemas',
  'tables',
  'warehouses',
  'roles',
  'file_formats',
  'procedures',
] as const

export type SnowflakeSelectorKind = (typeof SNOWFLAKE_SELECTOR_KINDS)[number]

export interface SnowflakeSelectorScope {
  database?: string
  schema?: string
}

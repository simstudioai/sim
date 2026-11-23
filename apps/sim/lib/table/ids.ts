import { generateId } from '@sim/utils/id'

const TABLE_ID_PREFIX = 'tbl_'

/** The shape {@link generateTableId} mints: the prefix and 32 lowercase hex digits. */
const TABLE_ID_SHAPE = new RegExp(`^${TABLE_ID_PREFIX}[0-9a-f]{32}$`)

/**
 * Whether `reference` is shaped like a table id, so it is never read as a table name: a name
 * that merely starts with `tbl_` (`tbl_sales`) still is one.
 */
export function isTableIdShaped(reference: string): boolean {
  return TABLE_ID_SHAPE.test(reference)
}

/**
 * Whether `reference`, a table route's `{tableId}`, names `table`: its id, or (when not shaped
 * like an id) its name, which is unique among a workspace's active tables.
 */
export function referencesTable(reference: string, table: { id: string; name: string }): boolean {
  return reference === table.id || (!isTableIdShaped(reference) && reference === table.name)
}

/**
 * Mints a fresh table id: `tbl_` plus a dash-stripped v4 UUID, the shape Tables have carried
 * since they shipped and the one the CLI and Copilot describe to users. Every path that
 * creates a table definition — the create service and the fork copy — mints through here, so
 * a table's id never reveals which path made it.
 */
export function generateTableId(): string {
  return `${TABLE_ID_PREFIX}${generateId().replace(/-/g, '')}`
}

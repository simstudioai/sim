import { generateId } from '@sim/utils/id'

/** What every table id starts with: a reference that does not is no table id. */
export const TABLE_ID_PREFIX = 'tbl_'

/**
 * Whether `reference`, a table route's `{tableId}`, names `table`: its id, or (when not shaped
 * like an id) its name, which is unique among a workspace's active tables.
 */
export function referencesTable(reference: string, table: { id: string; name: string }): boolean {
  return (
    reference === table.id || (!reference.startsWith(TABLE_ID_PREFIX) && reference === table.name)
  )
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

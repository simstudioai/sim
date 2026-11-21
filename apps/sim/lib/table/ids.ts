import { generateId } from '@sim/utils/id'

/** What every table id starts with: a reference that does not is no table id. */
export const TABLE_ID_PREFIX = 'tbl_'

/**
 * Mints a fresh table id: `tbl_` plus a dash-stripped v4 UUID, the shape Tables have carried
 * since they shipped and the one the CLI and Copilot describe to users. Every path that
 * creates a table definition — the create service and the fork copy — mints through here, so
 * a table's id never reveals which path made it.
 */
export function generateTableId(): string {
  return `${TABLE_ID_PREFIX}${generateId().replace(/-/g, '')}`
}

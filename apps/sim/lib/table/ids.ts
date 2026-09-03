import { generateId } from '@sim/utils/id'

/**
 * Mints a fresh table id: `tbl_` plus a dash-stripped v4 UUID, the shape Tables have carried
 * since they shipped and the one the CLI and Copilot describe to users. Every path that
 * creates a table definition — the create service and the fork copy — mints through here, so
 * a table's id never reveals which path made it.
 */
export function generateTableId(): string {
  return `tbl_${generateId().replace(/-/g, '')}`
}

'use client'

import { Table } from './components'

/**
 * Page-level wrapper for the table detail view. Mirrors the shape of
 * `logs/logs.tsx`: a thin orchestrator that composes the data grid and the
 * page-level surface (sidebars, modals, action bar, breadcrumbs).
 *
 * Today this is a passthrough — `<Table>` still owns its own surface state.
 * Subsequent commits lift surface state out of `<Table>` into this wrapper
 * one piece at a time so each move is independently shippable.
 *
 * The mothership chat path uses `<Table embedded>` directly (see
 * `home/components/mothership-view/.../resource-content.tsx`) — it's a public,
 * lower-level component for embedded contexts. `<TablesDetail>` is page-only.
 */
export function TablesDetail() {
  return <Table />
}

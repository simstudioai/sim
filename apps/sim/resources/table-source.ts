import type { ColumnDefinition } from '@/lib/table/types'
import type { ResourceSource, ShareSource } from '@/resources/source'

/**
 * Address helpers for the table resource — the table half of what
 * `file-source.ts` does for files.
 *
 * Pure TypeScript, no React: a Server Component builds a share source during SSR,
 * so nothing here may reach for a hook or the DOM.
 */

/**
 * The workspace a table source belongs to, or `null` when only a share token
 * reaches it.
 *
 * This is the value that decides whether a cell may render a `sim-resource`
 * chip: that chip's renderer mounts workspace-authenticated list queries, so a
 * share source must yield `null` and the resolver then never emits the kind.
 * See `components/resources/table-view/cells/cell-render.test.ts`.
 */
export function tableWorkspaceId(source: ResourceSource<'table'>): string | null {
  return source.via === 'workspace' ? source.workspaceId : null
}

/**
 * The schema a shared table renders from.
 *
 * Read from the seed the share page already proved server-side rather than
 * fetched: there is no public "get table" endpoint, and adding one would hand a
 * token the ability to describe tables it was never granted. Mirrors
 * `shareFileRecord`.
 */
export function shareTableSchema(source: ShareSource<'table'>): {
  name: string
  columns: ColumnDefinition[]
} {
  return source.seed
}

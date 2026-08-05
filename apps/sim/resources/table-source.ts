import type { ResourceSource } from '@/resources/source'

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

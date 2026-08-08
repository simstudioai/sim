import type { ResourceSource } from '@/resources/source'

/**
 * Address helpers for the table resource — the table half of what
 * `file-source.ts` does for files.
 *
 * Pure TypeScript, no React: nothing here may reach for a hook or the DOM.
 */

/**
 * The workspace a table source belongs to, or `null` when only a share token
 * reaches it.
 *
 * `ResourceSeedMap['table']` is `never`, so a share source for a table is not
 * constructible today and this never returns `null` in practice — but the union
 * still has two arms, and narrowing it once here is what keeps every consumer
 * from re-deriving the same check.
 */
export function tableWorkspaceId(source: ResourceSource<'table'>): string | null {
  return source.via === 'workspace' ? source.workspaceId : null
}

/** The table's own id, or `null` when only a share token reaches it. */
export function tableResourceId(source: ResourceSource<'table'>): string | null {
  return source.via === 'workspace' ? source.resourceId : null
}

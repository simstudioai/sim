import type { ResourceSource } from '@/resources/source'

/**
 * Address helpers for the knowledge resource — the knowledge half of what
 * `file-source.ts` does for files.
 *
 * Pure TypeScript, no React: nothing here may reach for a hook or the DOM.
 */

/**
 * The workspace a knowledge base belongs to, or `null` when only a share token
 * reaches it.
 *
 * `ResourceSeedMap['knowledge']` is `never`, so a share source is not
 * constructible today and this never returns `null` in practice — but the union
 * still has two arms, and narrowing it once here keeps every consumer from
 * re-deriving the same check.
 */
export function knowledgeWorkspaceId(source: ResourceSource<'knowledge'>): string | null {
  return source.via === 'workspace' ? source.workspaceId : null
}

/**
 * The in-app route for one document inside this knowledge base, or `null` when
 * there is nowhere to send the viewer.
 *
 * A document is not a {@link ResourceKind} — it has no view, no grants and no
 * share surface of its own — so it cannot be spelled through
 * `source.hrefFor({ to: 'resource' })`. It is a sub-path of the knowledge base,
 * which is why it lives in this per-kind module rather than the shared route
 * table, exactly as `logWorkflowHref` does for a log's workflow.
 */
export function knowledgeDocumentHref(
  source: ResourceSource<'knowledge'>,
  documentId: string
): string | null {
  if (source.via !== 'workspace') return null
  const base = source.hrefFor({ to: 'self' })
  return base ? `${base}/${encodeURIComponent(documentId)}` : null
}

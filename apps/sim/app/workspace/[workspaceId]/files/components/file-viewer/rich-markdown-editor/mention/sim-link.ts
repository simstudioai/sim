/**
 * Resolves the in-app route for a clicked `sim:` mention, or `null` when the kind has no navigable
 * destination. Each path matches the entity's real route: files open the file detail view,
 * folders/skills deep-link the file browser / skills modal via their query params, the rest hit their
 * `[id]` route. Integrations are intentionally non-navigable — a mention's id is a block *type*
 * (`gmail_v2`), which isn't a routable resource (no per-type page; it maps to zero-or-many
 * credentials), so the chip stays display-only.
 */
export function simLinkPath(workspaceId: string, kind: string, id: string): string | null {
  const base = `/workspace/${workspaceId}`
  switch (kind) {
    case 'file':
      return `${base}/files/${id}/view`
    case 'folder':
      return `${base}/files?folderId=${id}`
    case 'table':
      return `${base}/tables/${id}`
    case 'knowledge':
      return `${base}/knowledge/${id}`
    case 'workflow':
      return `${base}/w/${id}`
    case 'skill':
      return `${base}/skills?skillId=${id}`
    default:
      return null
  }
}

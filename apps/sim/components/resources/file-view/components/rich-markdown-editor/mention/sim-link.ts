import { isResourceKind, type ResourceSource } from '@/resources'

/**
 * The link scheme for `@`-mention links — `[label](sim:<kind>/<id>)`. Matches the chat composer's
 * portable chip format (`chip-clipboard-codec.ts`), so a mention authored here is parseable there.
 */
export const SIM_LINK_SCHEME = 'sim'

/** Builds the link target for a mention of `kind`/`id`. */
export function toSimHref(kind: string, id: string): string {
  return `${SIM_LINK_SCHEME}:${kind}/${id}`
}

/**
 * Resolves the in-app route for a clicked `sim:` mention, or `null` when the kind has no navigable
 * destination from the surrounding resource.
 *
 * A mention's vocabulary is wider than the resource axis. Files, tables and knowledge bases ARE
 * resources, so they are addressed through the source's `hrefFor` and their routes stay declared
 * exactly once; folders, workflows and skills are deliberately not resources (a folder is structure
 * *inside* files, a workflow is a collaborative socket session) and keep their routes here.
 * Integrations are intentionally non-navigable — a mention's id is a block *type* (`gmail_v2`), which
 * isn't a routable resource (no per-type page; it maps to zero-or-many credentials), so the chip
 * stays display-only.
 *
 * Every branch resolves to `null` against a share source: an anonymous page has no workspace routes
 * to send a visitor to, so the mention renders inert rather than linking somewhere that cannot exist.
 */
export function simLinkPath(source: ResourceSource, kind: string, id: string): string | null {
  if (isResourceKind(kind)) return source.hrefFor({ to: 'resource', kind, id })
  if (source.via !== 'workspace') return null

  const base = `/workspace/${source.workspaceId}`
  switch (kind) {
    case 'folder':
      return `${base}/files?folderId=${id}`
    case 'workflow':
      return `${base}/w/${id}`
    case 'skill':
      return `${base}/skills?skillId=${id}`
    default:
      return null
  }
}

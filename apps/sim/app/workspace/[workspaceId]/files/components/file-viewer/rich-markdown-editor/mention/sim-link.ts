/**
 * The link scheme for `@`-mention links — `[label](sim:<kind>/<id>)`. Matches the chat composer's
 * portable chip format (`chip-clipboard-codec.ts`), so a mention authored here is parseable there.
 */
export const SIM_LINK_SCHEME = 'sim'

/** A bare `sim:<kind>/<id>` mention href (the link target inserted by the `@` menu). */
const SIM_HREF_PATTERN = /^sim:([a-z_]+)\/(.+)$/

/** Builds the link target for a mention of `kind`/`id`. */
export function toSimHref(kind: string, id: string): string {
  return `${SIM_LINK_SCHEME}:${kind}/${id}`
}

/** Parses a `sim:<kind>/<id>` href into its parts, or `null` if it isn't a sim mention link. */
export function parseSimHref(href: string): { kind: string; id: string } | null {
  const match = href.match(SIM_HREF_PATTERN)
  return match ? { kind: match[1], id: match[2] } : null
}

/**
 * Resolves the in-app route for a clicked `sim:` mention link, or `null` for an unknown kind. Each
 * destination matches the entity's real route: files open the file detail view, folders/skills deep-link
 * the file browser / skills modal via their query params, the rest hit their `[id]` route.
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
    case 'integration':
      return `${base}/integrations/${id}`
    default:
      return null
  }
}

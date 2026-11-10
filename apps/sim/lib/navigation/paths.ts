/**
 * Top-level destinations of the signed-in app. Dependency-free so the edge proxy,
 * server components, and client code all read the same values.
 */

/**
 * Where an authenticated viewer lands when nothing more specific was asked for:
 * after login, from `/`, and from every "open Sim" affordance. A server route
 * that resolves to the viewer's organization surface, or to their workspaces when
 * they belong to no organization. Every default post-auth destination must point
 * here rather than at a concrete surface, so the landing decision lives in one place.
 */
export const APP_ENTRY_PATH = '/home'

/** Keeps the landing page visible even when the viewer is signed in. */
export const LANDING_HREF = '/?home'

/**
 * The workspace picker: resolves to the viewer's most recent workspace. Use it only
 * where the viewer explicitly asked for workspaces; the default landing is
 * {@link APP_ENTRY_PATH}.
 */
export const WORKSPACES_PATH = '/workspace'

/** Opens full settings in the viewer's most recent accessible workspace. */
export const WORKSPACE_SETTINGS_PATH = `${WORKSPACES_PATH}?redirect=settings`

/** A workspace itself; its route opens the page `workspaceHome` names for the server's data. */
export function workspaceEntry(workspaceId: string) {
  return `${WORKSPACES_PATH}/${encodeURIComponent(workspaceId)}`
}

export function workspacePath(workspaceId: string, section: string) {
  return `${WORKSPACES_PATH}/${encodeURIComponent(workspaceId)}/${section}`
}

/** Root of the organization surface; `/o` alone resolves like {@link APP_ENTRY_PATH}. */
const ORGANIZATIONS_PATH = '/o'

/**
 * Every destination under one organization's surface, built from one place so the
 * sidebar, redirects, and pages can never disagree about a path.
 */
export function organizationRoutes(organizationId: string) {
  const root = `${ORGANIZATIONS_PATH}/${organizationId}`
  return {
    root,
    home: `${root}/home`,
    search: `${root}/search`,
    searchChat: (chatId: string) => `${root}/search/chat/${encodeURIComponent(chatId)}`,
    integrations: `${root}/integrations`,
    integration: (providerId: string) => `${root}/integrations/${encodeURIComponent(providerId)}`,
    /** A connected account's own page: its tool permissions. */
    account: (credentialId: string) =>
      `${root}/integrations/accounts/${encodeURIComponent(credentialId)}`,
    accessRequests: `${root}/access-requests`,
    memberSecrets: `${root}/integrations/secrets`,
    simLinks: `${root}/settings/links`,
    people: `${root}/people`,
    person: (memberId: string) => `${root}/people/${encodeURIComponent(memberId)}`,
    organizationSecrets: `${root}/settings/integrations/secrets`,
    skills: `${root}/integrations?tab=skills`,
    settings: `${root}/settings`,
    searchProvider: (connectorType: string) =>
      `${root}/settings/integrations/providers/${encodeURIComponent(connectorType)}`,
    searchSource: (connectorId: string) =>
      `${root}/settings/integrations/sources/${encodeURIComponent(connectorId)}`,
    settingsSection: (section: string) => `${root}/settings/${section}`,
    /** A new chat; `chat` opens an existing one. */
    newChat: `${root}/chat`,
    chat: (chatId: string) => `${root}/chat/${encodeURIComponent(chatId)}`,
  } as const
}

/** Where `sim/<name>/<values…>` resolves in this app: the address a member types, kept verbatim. */
export function simLinkPath(...segments: string[]): string {
  return ['/sim', ...segments.map(encodeURIComponent)].join('/')
}

/** The full address of `sim/<name>` on `origin`, which opens it with or without the extension. */
export function simLinkUrl(origin: string, name: string): string {
  return new URL(simLinkPath(name), origin).href
}

/** Whether `pathname` is `root` itself or a route beneath it. */
export function isPathOrDescendant(pathname: string, root: string): boolean {
  return pathname === root || pathname.startsWith(`${root}/`)
}

/**
 * Whether a pathname belongs to the signed-in app — the entry, the workspaces, or
 * the organization surface — and so requires a session before it renders.
 */
export function isAppSurfacePath(pathname: string): boolean {
  return (
    isPathOrDescendant(pathname, APP_ENTRY_PATH) ||
    isPathOrDescendant(pathname, WORKSPACES_PATH) ||
    isPathOrDescendant(pathname, ORGANIZATIONS_PATH)
  )
}

/**
 * Non-app routes that must never appear in search results: deployed chats, paused-run
 * resume links, invitations, unsubscribe links, shared files, the legacy `/w` redirects,
 * the design playground, and account, self-host, and upgrade utility pages.
 */
const NOINDEX_PATH_ROOTS = [
  '/sim',
  '/chat',
  '/extension',
  '/resume',
  '/invite',
  '/unsubscribe',
  '/f',
  '/w',
  '/playground',
  '/account',
  '/selfhost',
  '/upgrade',
] as const

/** Whether a pathname is an app or utility surface that search engines must not index. */
export function isNoindexPath(pathname: string): boolean {
  return (
    isAppSurfacePath(pathname) ||
    NOINDEX_PATH_ROOTS.some((root) => isPathOrDescendant(pathname, root))
  )
}

/** Each URL path segment decoded, or `null` when one is not valid percent-encoding (`%ZZ`). */
export function decodePathSegments(segments: readonly string[]): string[] | null {
  try {
    return segments.map(decodeURIComponent)
  } catch {
    return null
  }
}

/**
 * The `:name` values `pattern` (`members/:id`) captures from `segments`, or `null` when it does not
 * match: a `:name` part matches any one segment, every other part only itself.
 */
export function matchPathPattern(
  pattern: string,
  segments: readonly string[]
): Record<string, string> | null {
  const parts = pattern.split('/')
  if (parts.length !== segments.length) return null
  const params: Record<string, string> = {}
  for (const [index, part] of parts.entries()) {
    if (part.startsWith(':')) params[part.slice(1)] = segments[index]
    else if (part !== segments[index]) return null
  }
  return params
}

/** A page's search params as a query: a repeated key's values in order, an absent one dropped. */
export function searchParamsQuery(
  searchParams: Readonly<Record<string, string | string[] | undefined>>
): URLSearchParams {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(searchParams))
    for (const entry of [value ?? []].flat()) query.append(key, entry)
  return query
}

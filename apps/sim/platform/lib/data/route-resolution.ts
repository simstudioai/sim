import 'server-only'
import { cookies, headers } from 'next/headers'
import { notFound, permanentRedirect, redirect } from 'next/navigation'
import { resourceParam } from '@/lib/mothership/chat/search-params'
import { mapLegacyWorkspaceUrl } from '@/lib/navigation/legacy-redirects'
import { organizationRoutes, WORKSPACE_SETTINGS_PATH } from '@/lib/navigation/paths'
import { settingsAliasHref } from '@/lib/navigation/settings-aliases'
import { SHELL_PATH_HEADER } from '@/lib/navigation/shell-scope'
import {
  pinnedSearchHref,
  readRememberedSearchMode,
  type SearchMode,
  searchModeCookieName,
} from '@/lib/organizations/search-params'
import { resolveLegacyRequestLink } from '@/platform/lib/data/legacy-request-link'
import { type PlatformOrganization, surfaceHref } from '@/platform/lib/data/organization-model'
import { requireSessionViewer } from '@/platform/lib/data/server-read'
import { resolveLiveSetting } from '@/platform/lib/data/settings-navigation'
import { readWorkspaceShellOrganizationId } from '@/platform/lib/data/shell-scope'
import { workspaceRootHref } from '@/platform/lib/workspace-navigation'

/**
 * The product's route resolution: every redirect a product URL answers from its shape and the
 * viewer's organization surface, in one table. The live shell runs it for a document request,
 * before anything streams, so the viewer gets one HTTP redirect; each page runs it for its own
 * location, so a client navigation lands in the same place. A redirect that depends on a record (a
 * chat's mode, an integration's links) stays in its page.
 */

/** The path and query a request opens. */
export interface ProductLocation {
  pathname: string
  query: URLSearchParams
}

/** What the rules read besides the URL. */
export interface RouteContext {
  /** The viewer's surface in the shell's organization. */
  organization: PlatformOrganization
  /** The Search mode the viewer last used here, which a bare Search URL is pinned to. */
  rememberedSearchMode: SearchMode | null
  /** The organization a `/workspace/<id>` path's workspace opens in, `null` when the viewer cannot. */
  workspaceOrganizationId: string | null
}

export interface ProductRedirect {
  href: string
  /** A moved legacy URL, which answers 308 so saved links update. */
  permanent: boolean
}

/** A page's search params as the query the rules read. */
export function productLocation(
  pathname: string,
  searchParams: Record<string, string | string[] | undefined>
): ProductLocation {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(searchParams))
    for (const entry of [value ?? []].flat()) query.append(key, entry)
  return { pathname, query }
}

/** The query in the shape Next hands a page: a repeated key's values as an array, in order. */
function queryRecord(query: URLSearchParams): Record<string, string | string[]> {
  const record: Record<string, string | string[]> = {}
  for (const key of new Set(query.keys())) {
    const values = query.getAll(key)
    record[key] = values.length === 1 ? values[0] : values
  }
  return record
}

/** The legacy surface's rule for when a member has nothing of theirs on the organization surface. */
function hasOrganizationSurface(organization: PlatformOrganization): boolean {
  const { mothershipAvailable, searchAccess, navFlags } = organization
  return mothershipAvailable || searchAccess.memberScoped || navFlags.people || navFlags.simLinks
}

/**
 * Where a member with nothing of theirs on the organization surface goes from any organization
 * page: workspace Settings, which is outside the organization's pages, so it never redirects again.
 * The organization layout applies it to a client navigation into the organization.
 */
export function resolveOrganizationGate(organization: PlatformOrganization): string | null {
  return hasOrganizationSurface(organization) ? null : WORKSPACE_SETTINGS_PATH
}

/** Where the organization's bare URL sends a viewer: the legacy organization root's priority chain. */
function organizationLandingPath(organization: PlatformOrganization): string {
  const { mothershipAvailable, canBuild, searchAccess, navFlags } = organization
  const routes = organizationRoutes(organization.organization.id)
  if (mothershipAvailable && canBuild) return routes.home
  if (searchAccess.memberScoped) return routes.search
  if (navFlags.people) return routes.people
  return navFlags.simLinks ? routes.simLinks : WORKSPACE_SETTINGS_PATH
}

/**
 * The legacy Home page's gate (a member who cannot build goes to Search, otherwise to Settings), then
 * its resource panel: Home with `?resource=` was a new chat with that panel, which the new chat owns.
 */
function resolveHomeEntry(organization: PlatformOrganization, query: URLSearchParams) {
  const { mothershipAvailable, canBuild, searchAccess } = organization
  if (!mothershipAvailable || !canBuild)
    return searchAccess.memberScoped
      ? surfaceHref(organization, '/search')
      : WORKSPACE_SETTINGS_PATH
  if (!query.get(resourceParam.key)) return null
  return `${surfaceHref(organization, '/chat')}?${query}`
}

/** The legacy Search pages' gates, and a bare Search URL pinned to the remembered mode. */
function resolveSearchEntry(
  organization: PlatformOrganization,
  chat: boolean,
  query: URLSearchParams,
  remembered: SearchMode | null
): string | null {
  if (!organization.searchAccess.memberScoped) return surfaceHref(organization, '/settings')
  if (!organization.mothershipAvailable) return chat ? surfaceHref(organization, '/search') : null
  if (chat) return null
  return pinnedSearchHref(surfaceHref(organization, '/search'), queryRecord(query), remembered)
}

/** A saved access-request link into a Settings section, when the viewer may open Requests. */
function resolveSettingsEntry(
  organization: PlatformOrganization,
  [key = 'general', ...subpath]: readonly string[],
  query: URLSearchParams
): string | null {
  if (subpath.length || !resolveLiveSetting('requests', organization)) return null
  return resolveLegacyRequestLink(organization, key, queryRecord(query))
}

function decodeSegments(segments: readonly string[]): string[] | null {
  try {
    return segments.map(decodeURIComponent)
  } catch {
    return null
  }
}

const temporary = (href: string | null): ProductRedirect | null =>
  href ? { href, permanent: false } : null

/**
 * The redirect `location` answers, or `null` to render it. Pure: the caller reads the context. The
 * organization gate applies only under the organization's own prefix; a `/workspace` URL is never
 * sent to workspace Settings, which is itself a `/workspace` URL.
 */
export function resolveProductRedirect(
  { pathname, query }: ProductLocation,
  { organization, rememberedSearchMode, workspaceOrganizationId }: RouteContext
): ProductRedirect | null {
  const [, root, id, ...rest] = pathname.split('/')
  const segments = decodeSegments(rest)
  if (!id || !segments) return null

  if (root === 'o') {
    if (`/o/${id}` !== organization.routePrefix) return null
    const gate = resolveOrganizationGate(organization)
    if (gate) return temporary(gate)
    const [section, ...subpath] = segments
    if (section === undefined) return temporary(organizationLandingPath(organization))
    if (section === 'home' && !subpath.length)
      return temporary(resolveHomeEntry(organization, query))
    if (section === 'search' && (!subpath.length || subpath[0] === 'chat'))
      return temporary(
        resolveSearchEntry(organization, subpath.length > 0, query, rememberedSearchMode)
      )
    if (section === 'settings') {
      const alias = settingsAliasHref(organization.routePrefix, subpath, query)
      if (alias) return { href: alias, permanent: true }
      return temporary(resolveSettingsEntry(organization, subpath, query))
    }
    return null
  }

  if (root === 'workspace') {
    const workspaceId = decodeSegments([id])?.[0]
    if (!workspaceId) return null
    if (!segments.length) return temporary(workspaceRootHref(workspaceId, 'live', query))
    const href = mapLegacyWorkspaceUrl({
      workspaceId,
      segments,
      query,
      organizationId: workspaceOrganizationId,
    })
    return href ? { href, permanent: true } : null
  }
  return null
}

/** The Search mode the viewer last used in the organization, from its cookie. */
async function readRememberedMode(organization: PlatformOrganization): Promise<SearchMode | null> {
  if (!organization.mothershipAvailable) return null
  const [viewer, cookieStore] = await Promise.all([requireSessionViewer(), cookies()])
  return readRememberedSearchMode(
    cookieStore.get(searchModeCookieName(organization.organization.id))?.value,
    viewer.principal.userId
  )
}

/**
 * Answers `location` with its redirect, if the table has one. A page calls it for its own location
 * on every render; the live shell calls it for the document's.
 */
export async function followProductRoute(
  organization: PlatformOrganization,
  location: ProductLocation
): Promise<void> {
  const [, root, id] = location.pathname.split('/')
  const workspaceId = root === 'workspace' && id ? decodeSegments([id])?.[0] : undefined
  const [rememberedSearchMode, workspaceOrganizationId] = await Promise.all([
    readRememberedMode(organization),
    workspaceId ? readWorkspaceShellOrganizationId(workspaceId) : null,
  ])
  // A workspace the viewer cannot open answers 404 before anything streams, and names no organization.
  if (workspaceId && workspaceOrganizationId === null) notFound()
  const target = resolveProductRedirect(location, {
    organization,
    rememberedSearchMode,
    workspaceOrganizationId,
  })
  if (!target) return
  if (target.permanent) permanentRedirect(target.href)
  redirect(target.href)
}

/**
 * The path and query this document request opens, as the proxy names it; `null` outside the proxy.
 * The shell renders above the page's Suspense boundary and without route params, so this is how it
 * learns the location to resolve before anything streams.
 */
export async function readDocumentLocation(): Promise<ProductLocation | null> {
  const location = (await headers()).get(SHELL_PATH_HEADER)
  if (location === null) return null
  const url = new URL(location, 'https://product.invalid')
  // A refresh's RSC request carries Next's cache-busting key, which no destination should keep.
  url.searchParams.delete('_rsc')
  return { pathname: url.pathname, query: url.searchParams }
}

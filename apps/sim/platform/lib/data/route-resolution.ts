import 'server-only'
import { cookies, headers } from 'next/headers'
import { permanentRedirect, redirect } from 'next/navigation'
import { resourceParam } from '@/lib/mothership/chat/search-params'
import { mapLegacyWorkspaceUrl } from '@/lib/navigation/legacy-redirects'
import {
  decodePathSegments,
  organizationRoutes,
  searchParamsQuery,
  WORKSPACES_PATH,
} from '@/lib/navigation/paths'
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
  return { pathname, query: searchParamsQuery(searchParams) }
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

/**
 * The first organization page the viewer has, in the legacy organization root's priority order, or
 * `null` when nothing on the organization surface is theirs. The organization gate, the root's
 * landing and the workspace entry's hand-off all read this one answer, so a page the gate lets
 * through is always one the landing can reach, and none of them can send the viewer back to another.
 */
function organizationLandingHref(organization: PlatformOrganization): string | null {
  const { mothershipAvailable, searchAccess, navFlags } = organization
  const routes = organizationRoutes(organization.organization.id)
  if (mothershipAvailable) return routes.home
  if (searchAccess.memberScoped) return routes.search
  if (navFlags.people) return routes.people
  return navFlags.simLinks ? routes.simLinks : null
}

/** Whether `pathname` is one of the organization's Settings pages, which decide their own sections. */
function isSettingsPath(organization: PlatformOrganization, pathname: string): boolean {
  const settings = surfaceHref(organization, '/settings')
  return pathname === settings || pathname.startsWith(`${settings}/`)
}

/**
 * Where a member with nothing of theirs on the organization surface goes from an organization page:
 * their workspace, as legacy sent them, with the query kept. Settings is exempt: its account and
 * per-section pages stay reachable, each deciding its own visibility. The workspace entry hands a
 * viewer back only to {@link organizationLandingHref}, which is never this gate's target, so it
 * never redirects again. The organization layout applies it to a client navigation.
 */
export function resolveOrganizationGate(
  organization: PlatformOrganization,
  location: ProductLocation | null
): string | null {
  if (organizationLandingHref(organization)) return null
  if (location && isSettingsPath(organization, location.pathname)) return null
  return withQuery(WORKSPACES_PATH, location?.query ?? new URLSearchParams())
}

/**
 * Where the bare `/workspace` entry sends a viewer who has no workspace and may not create one: the
 * organization's Settings when the entry asked for them, else its landing page; `null` (the blocked
 * explanation) when nothing on the organization is theirs. Never `/workspace` itself.
 */
export function blockedWorkspaceEntryHref(
  organization: PlatformOrganization,
  redirect: string | null
): string | null {
  const landing = organizationLandingHref(organization)
  if (!landing) return null
  return redirect === 'settings' ? surfaceHref(organization, '/settings') : landing
}

/**
 * The legacy Home page's gate (a member without chat goes to Search, otherwise to their workspace),
 * then its resource panel: Home with `?resource=` was a new chat with that panel, which the new chat
 * owns.
 */
function resolveHomeEntry(organization: PlatformOrganization, query: URLSearchParams) {
  const { mothershipAvailable, searchAccess } = organization
  if (!mothershipAvailable)
    return searchAccess.memberScoped ? surfaceHref(organization, '/search') : WORKSPACES_PATH
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

/**
 * A saved access-request link into a Settings section lands on Requests, whose own gate then
 * decides, as the legacy Settings did: a viewer who may not open Requests gets not found there.
 */
function resolveSettingsEntry(
  organization: PlatformOrganization,
  [key = 'general', ...subpath]: readonly string[],
  query: URLSearchParams
): string | null {
  if (subpath.length) return null
  return resolveLegacyRequestLink(organization, key, queryRecord(query))
}

/** `href` with the query appended, after any query it already has. */
function withQuery(href: string, query: URLSearchParams): string {
  if (!query.size) return href
  return `${href}${href.includes('?') ? '&' : '?'}${query}`
}

const temporary = (href: string | null): ProductRedirect | null =>
  href ? { href, permanent: false } : null

/**
 * The redirect `location` answers, or `null` to render it. Pure: the caller reads the context. The
 * organization gate applies only under the organization's own prefix; a `/workspace` URL is never
 * sent to the workspace entry, which is itself a `/workspace` URL.
 */
export function resolveProductRedirect(
  { pathname, query }: ProductLocation,
  { organization, rememberedSearchMode, workspaceOrganizationId }: RouteContext
): ProductRedirect | null {
  const [, root, id, ...rest] = pathname.split('/')
  const segments = decodePathSegments(rest)
  if (!id || !segments) return null

  if (root === 'o') {
    if (`/o/${id}` !== organization.routePrefix) return null
    const gate = resolveOrganizationGate(organization, { pathname, query })
    if (gate) return temporary(gate)
    const [section, ...subpath] = segments
    if (section === undefined)
      return temporary(withQuery(organizationLandingHref(organization) ?? WORKSPACES_PATH, query))
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
    const workspaceId = decodePathSegments([id])?.[0]
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
  const [, root, id, section] = location.pathname.split('/')
  const workspaceId = root === 'workspace' && id ? decodePathSegments([id])?.[0] : undefined
  const [rememberedSearchMode, workspaceOrganizationId] = await Promise.all([
    root === 'o' && section === 'search' ? readRememberedMode(organization) : null,
    workspaceId ? readWorkspaceShellOrganizationId(workspaceId) : null,
  ])
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

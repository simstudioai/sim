import 'server-only'
import { cookies } from 'next/headers'
import {
  pinnedSearchHref,
  readRememberedSearchMode,
  searchModeCookieName,
} from '@/lib/organizations/search-params'
import type { ShellLocation } from '@/platform/lib/data/landing'
import { type PlatformOrganization, surfaceHref } from '@/platform/lib/data/organization-model'
import { requireSessionViewer } from '@/platform/lib/data/server-read'

/**
 * Where a Search URL naming no mode redirects: pinned to the viewer's remembered mode, so the page
 * loads with its mode and the client never writes it. Null when there is nothing to pin.
 */
export async function readPinnedSearchHref(
  organization: PlatformOrganization,
  searchParams: Record<string, string | string[] | undefined>
): Promise<string | null> {
  if (!organization.mothershipAvailable) return null
  const [viewer, cookieStore] = await Promise.all([requireSessionViewer(), cookies()])
  const remembered = readRememberedSearchMode(
    cookieStore.get(searchModeCookieName(organization.organization.id))?.value,
    viewer.principal.userId
  )
  return pinnedSearchHref(surfaceHref(organization, '/search'), searchParams, remembered)
}

/**
 * The same pin for a document request, applied by the shell before anything streams so the viewer
 * gets one HTTP redirect; a redirect from the page itself would paint first and navigate again.
 */
export function readEntrySearchPin(
  organization: PlatformOrganization,
  location: ShellLocation | null
): Promise<string | null> | null {
  if (!location || location.pathname !== surfaceHref(organization, '/search')) return null
  if (!organization.searchAccess.memberScoped) return null
  const searchParams: Record<string, string[]> = {}
  for (const [key, value] of location.query) (searchParams[key] ??= []).push(value)
  return readPinnedSearchHref(organization, searchParams)
}

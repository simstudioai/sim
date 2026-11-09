import 'server-only'
import { cookies } from 'next/headers'
import {
  pinnedSearchHref,
  readRememberedSearchMode,
  searchModeCookieName,
} from '@/lib/organizations/search-params'
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

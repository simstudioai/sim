import { notFound, redirect } from 'next/navigation'
import { createLoader, createSerializer, type SearchParams } from 'nuqs/server'
import { getSession } from '@/lib/auth'
import { WORKSPACE_SETTINGS_PATH } from '@/lib/navigation/paths'
import { getOrganizationSurfaceContext } from '@/lib/organizations/surface'
import { organizationHomeParsers } from '@/app/o/[organizationId]/home/search-params'
import { searchFilterParsers } from '@/app/workspace/[workspaceId]/home/search-params'

const parsers = { ...organizationHomeParsers, ...searchFilterParsers }
const loadSearch = createLoader(parsers)
const serializeSearch = createSerializer(parsers)

/** Existing search bookmarks now land in Home's results-only view. */
export default async function OrganizationSearchPage({
  params,
  searchParams = Promise.resolve({}),
}: {
  params: Promise<{ organizationId: string }>
  searchParams?: Promise<SearchParams>
}) {
  const { organizationId } = await params
  const session = await getSession()
  if (!session?.user?.id) notFound()
  const context = await getOrganizationSurfaceContext(organizationId, session.user.id)
  if (!context) notFound()
  if (!context.searchAccess.memberScoped) redirect(WORKSPACE_SETTINGS_PATH)
  const query = await loadSearch(searchParams)
  redirect(serializeSearch(`/o/${organizationId}/home`, { ...query, searchLevel: 'none' }))
}

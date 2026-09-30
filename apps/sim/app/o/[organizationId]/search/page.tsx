import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { organizationRoutes, WORKSPACE_SETTINGS_PATH } from '@/lib/navigation/paths'
import { getOrganizationSurfaceContext } from '@/lib/organizations/surface'
import { isOrgProjectViewEnabled } from '@/lib/projects/feature-flag'
import { OrganizationSearch } from '@/app/o/[organizationId]/search/search'

export const metadata: Metadata = { title: 'Search' }

export default async function OrganizationSearchPage({
  params,
}: {
  params: Promise<{ organizationId: string }>
}) {
  const { organizationId } = await params
  const session = await getSession()
  if (!session?.user?.id) notFound()
  const context = await getOrganizationSurfaceContext(organizationId, session.user.id)
  if (!context) notFound()
  if (!context.searchAccess.memberScoped) redirect(WORKSPACE_SETTINGS_PATH)
  /** With the org project view, search is a mode of the Home composer rather than its own page. */
  if (await isOrgProjectViewEnabled(organizationId))
    redirect(organizationRoutes(organizationId).home)
  return <OrganizationSearch userId={session.user.id} />
}

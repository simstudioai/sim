import { Suspense } from 'react'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { WORKSPACE_SETTINGS_PATH } from '@/lib/navigation/paths'
import { getOrganizationSurfaceContext } from '@/lib/organizations/surface'
import { HomeFallback } from '@/app/workspace/[workspaceId]/home/home-fallback'
import { OrganizationSearchSurface } from '@/platform/app/(shell)/search/_components/search-surface/search-surface'

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
  return (
    <Suspense fallback={<HomeFallback />}>
      <OrganizationSearchSurface userId={session.user.id} />
    </Suspense>
  )
}

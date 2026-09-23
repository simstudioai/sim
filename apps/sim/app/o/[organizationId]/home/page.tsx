import { Suspense } from 'react'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { organizationRoutes, WORKSPACE_SETTINGS_PATH } from '@/lib/navigation/paths'
import { getOrganizationSurfaceContext } from '@/lib/organizations/surface'
import { OrganizationHome } from '@/app/o/[organizationId]/home/organization-home'
import { HomeFallback } from '@/app/workspace/[workspaceId]/home/home-fallback'

export const metadata: Metadata = {
  title: 'Home',
}

export default async function OrganizationHomePage({
  params,
}: {
  params: Promise<{ organizationId: string }>
}) {
  const { organizationId } = await params
  const session = await getSession()
  if (!session?.user?.id) notFound()
  const context = await getOrganizationSurfaceContext(organizationId, session.user.id)
  if (!context) notFound()
  if (!context.mothershipAvailable && context.searchAccess.memberScoped)
    redirect(organizationRoutes(organizationId).search)
  if (!(context.mothershipAvailable && context.canBuild) && !context.searchAccess.memberScoped)
    redirect(WORKSPACE_SETTINGS_PATH)

  return (
    <Suspense fallback={<HomeFallback />}>
      <OrganizationHome userName={session.user.name} />
    </Suspense>
  )
}

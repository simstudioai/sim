import { Suspense } from 'react'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { getOrganizationSurfaceContext } from '@/lib/organizations/surface'
import { getOrganizationHomeRedirect } from '@/app/o/[organizationId]/home/home-redirect'
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
  const homeRedirect = getOrganizationHomeRedirect(context, organizationId)
  if (homeRedirect) redirect(homeRedirect)

  return (
    <Suspense fallback={<HomeFallback />}>
      <OrganizationHome userName={session.user.name} />
    </Suspense>
  )
}

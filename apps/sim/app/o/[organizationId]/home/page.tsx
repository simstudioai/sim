import { Suspense } from 'react'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { WORKSPACE_SETTINGS_PATH } from '@/lib/navigation/paths'
import { getOrganizationSurfaceContext } from '@/lib/organizations/surface'
import OrganizationHomeLoading from '@/app/o/[organizationId]/home/loading'
import { OrganizationHome } from '@/app/o/[organizationId]/home/organization-home'

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
  if (!context.mothershipAvailable) redirect(WORKSPACE_SETTINGS_PATH)

  return (
    <Suspense fallback={<OrganizationHomeLoading />}>
      <OrganizationHome userName={session.user.name} />
    </Suspense>
  )
}

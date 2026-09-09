import { Suspense } from 'react'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { organizationRoutes } from '@/lib/navigation/paths'
import { authorizeOrganizationSettingsSection } from '@/lib/settings/application/organization-section-access'
import { buildAuthCrossLink } from '@/app/(auth)/auth-redirect'
import OrganizationSourceLoading from '@/app/o/[organizationId]/settings/integrations/sources/[connectorId]/loading'
import { OrganizationSourceDetail } from '@/app/o/[organizationId]/settings/integrations/sources/[connectorId]/source-detail'

export const metadata: Metadata = { title: 'Search source' }

interface OrganizationSourcePageProps {
  params: Promise<{ organizationId: string; connectorId: string }>
}

export default async function OrganizationSourcePage({ params }: OrganizationSourcePageProps) {
  const { organizationId, connectorId } = await params
  const session = await getSession()
  if (!session?.user) {
    redirect(
      buildAuthCrossLink('/login', {
        callbackUrl: organizationRoutes(organizationId).searchSource(connectorId),
        isInviteFlow: false,
      })
    )
  }
  if (
    !(await authorizeOrganizationSettingsSection({
      organizationId,
      userId: session.user.id,
      section: 'integrations',
    }))
  )
    notFound()

  return (
    <Suspense fallback={<OrganizationSourceLoading />}>
      <OrganizationSourceDetail connectorId={connectorId} />
    </Suspense>
  )
}

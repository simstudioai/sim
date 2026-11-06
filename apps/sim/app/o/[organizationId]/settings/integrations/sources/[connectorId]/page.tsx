import { Suspense } from 'react'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { organizationRoutes } from '@/lib/navigation/paths'
import { authorizeOrganizationSettingsSection } from '@/lib/settings/application/organization-section-access'
import { buildAuthCrossLink } from '@/app/(auth)/auth-redirect'
import { LoadingRows } from '@/platform/design-system/components'
import { SourceDetail } from '@/platform/embedded/app/(shell)/settings/_components/sections/integrations/source-detail'
import { SettingsSubpageHost } from '@/platform/embedded/app/(shell)/settings/_components/settings-subpage-host'

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
    <SettingsSubpageHost section='integrations'>
      <Suspense fallback={<LoadingRows label='Loading integration' />}>
        <SourceDetail connectorId={connectorId} />
      </Suspense>
    </SettingsSubpageHost>
  )
}

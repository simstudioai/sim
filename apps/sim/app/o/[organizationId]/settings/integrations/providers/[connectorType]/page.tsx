import { Suspense } from 'react'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { organizationRoutes } from '@/lib/navigation/paths'
import { authorizeOrganizationSettingsSection } from '@/lib/settings/application/organization-section-access'
import { SEARCH_SOURCE_TYPES } from '@/lib/sim-search/connectors'
import { buildAuthCrossLink } from '@/app/(auth)/auth-redirect'
import { OrganizationProviderDetail } from '@/app/o/[organizationId]/settings/integrations/providers/[connectorType]/provider-detail'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'

interface OrganizationProviderPageProps {
  params: Promise<{ organizationId: string; connectorType: string }>
}

export async function generateMetadata({
  params,
}: OrganizationProviderPageProps): Promise<Metadata> {
  const { connectorType } = await params
  return {
    title: SEARCH_SOURCE_TYPES.find(([type]) => type === connectorType)?.[1].name ?? 'Integration',
  }
}

export default async function OrganizationProviderPage({ params }: OrganizationProviderPageProps) {
  const { organizationId, connectorType } = await params
  if (!SEARCH_SOURCE_TYPES.some(([type]) => type === connectorType)) notFound()
  const session = await getSession()
  if (!session?.user)
    redirect(
      buildAuthCrossLink('/login', {
        callbackUrl: organizationRoutes(organizationId).searchProvider(connectorType),
        isInviteFlow: false,
      })
    )
  if (
    !(await authorizeOrganizationSettingsSection({
      organizationId,
      userId: session.user.id,
      section: 'integrations',
    }))
  )
    notFound()
  return (
    <Suspense
      fallback={<SettingsEmptyState variant='inline'>Loading integration…</SettingsEmptyState>}
    >
      <OrganizationProviderDetail connectorType={connectorType} />
    </Suspense>
  )
}

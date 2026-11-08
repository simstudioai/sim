import { Suspense } from 'react'
import { LoadingRows } from '@sim/emcn/status/query-boundary'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { organizationRoutes } from '@/lib/navigation/paths'
import { serializeOrganizationPeople } from '@/lib/organizations/settings-integrations-params'
import { authorizeOrganizationSettingsSection } from '@/lib/settings/application/organization-section-access'
import { SEARCH_SOURCE_TYPES } from '@/lib/sim-search/connectors'
import { LIVE_SEARCH_SERVICE_PROVIDERS } from '@/lib/sim-search/live/policy-schema'
import { searchSetupParam } from '@/lib/sim-search/params'
import { buildAuthCrossLink } from '@/app/(auth)/auth-redirect'
import { ProviderDetail } from '@/platform/embedded/app/(shell)/settings/_components/sections/integrations/provider-detail'
import { SettingsSubpageHost } from '@/platform/embedded/app/(shell)/settings/_components/settings-subpage-host'

interface OrganizationProviderPageProps {
  params: Promise<{ organizationId: string; connectorType: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export async function generateMetadata({
  params,
}: OrganizationProviderPageProps): Promise<Metadata> {
  const { connectorType } = await params
  return {
    title: SEARCH_SOURCE_TYPES.find(([type]) => type === connectorType)?.[1].name ?? 'Integration',
  }
}

export default async function OrganizationProviderPage({
  params,
  searchParams,
}: OrganizationProviderPageProps) {
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
  if (!LIVE_SEARCH_SERVICE_PROVIDERS.includes(connectorType))
    redirect(organizationRoutes(organizationId).settingsSection('integrations'))
  const query = await searchParams
  const activeSetup =
    typeof query.addConnector === 'string'
      ? searchSetupParam.parser.parse(query.addConnector)
      : null
  if (query.view === 'accounts' && activeSetup === null) {
    redirect(
      serializeOrganizationPeople(
        organizationRoutes(organizationId).settingsSection('integrations'),
        {
          tab: 'people',
          integration: connectorType,
          'credential-group-people':
            typeof query['credential-group-people'] === 'string'
              ? query['credential-group-people']
              : null,
        }
      )
    )
  }
  return (
    <SettingsSubpageHost section='integrations'>
      <Suspense fallback={<LoadingRows label='Loading integration' />}>
        <ProviderDetail connectorType={connectorType} />
      </Suspense>
    </SettingsSubpageHost>
  )
}

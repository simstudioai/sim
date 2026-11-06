import { Suspense } from 'react'
import type { Metadata } from 'next'
import { organizationRoutes } from '@/lib/navigation/paths'
import { RedesignPageSurface } from '@/app/o/[organizationId]/_redesign/redesign-host'
import Loading from '@/app/o/[organizationId]/integrations/accounts/[credentialId]/loading'
import { IntegrationsPage } from '@/platform/app/(shell)/integrations/_components/integrations-page/integrations-page'
import { ToolPermissionsPanel } from '@/platform/app/(shell)/integrations/_components/tool-permissions/tool-permissions-panel'

export const metadata: Metadata = { title: 'Tool permissions', referrer: 'no-referrer' }

interface AccountToolPermissionsPageProps {
  params: Promise<{ organizationId: string; credentialId: string }>
}

export default async function AccountToolPermissionsPage({
  params,
}: AccountToolPermissionsPageProps) {
  const { organizationId, credentialId } = await params
  return (
    <Suspense fallback={<Loading />}>
      <RedesignPageSurface>
        <IntegrationsPage
          back={{ href: organizationRoutes(organizationId).integrations, label: 'Integrations' }}
        >
          <ToolPermissionsPanel
            organizationId={organizationId}
            credentialId={credentialId}
            showHeading
          />
        </IntegrationsPage>
      </RedesignPageSurface>
    </Suspense>
  )
}

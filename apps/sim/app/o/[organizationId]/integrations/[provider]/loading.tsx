import { RedesignPageSurface } from '@/app/o/[organizationId]/_redesign/redesign-host'
import { IntegrationsRouteFallback } from '@/platform/app/(shell)/integrations/_components/integrations-page/integrations-route'

export default function IntegrationDetailLoading() {
  return (
    <RedesignPageSurface>
      <IntegrationsRouteFallback detail />
    </RedesignPageSurface>
  )
}

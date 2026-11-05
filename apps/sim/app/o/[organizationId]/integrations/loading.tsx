import { IntegrationsHost } from '@/app/o/[organizationId]/integrations/integrations-host'
import { IntegrationsRouteFallback } from '@/platform/app/(shell)/integrations/_components/integrations-page/integrations-route'

export default function IntegrationsLoading() {
  return (
    <IntegrationsHost>
      <IntegrationsRouteFallback detail={false} />
    </IntegrationsHost>
  )
}

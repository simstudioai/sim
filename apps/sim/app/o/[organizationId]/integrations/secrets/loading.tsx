import { IntegrationsHost } from '@/app/o/[organizationId]/integrations/integrations-host'
import { IntegrationsPage } from '@/platform/app/(shell)/integrations/_components/integrations-page/integrations-page'
import { LoadingState } from '@/platform/app/(shell)/settings/_components/section-parts/section-parts'

/** Its own, so the secrets page does not inherit the Integrations list's heading while it loads. */
export default function MemberSecretsLoading() {
  return (
    <IntegrationsHost>
      <IntegrationsPage>
        <LoadingState label='Loading secrets…' />
      </IntegrationsPage>
    </IntegrationsHost>
  )
}

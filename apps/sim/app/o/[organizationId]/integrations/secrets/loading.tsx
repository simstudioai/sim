import { LoadingRows } from '@sim/emcn/status/query-boundary'
import { PageSurface } from '@sim/emcn-platform/surface'
import { IntegrationsPage } from '@/platform/embedded/app/(shell)/integrations/_components/integrations-page/integrations-page'

/** Its own, so the secrets page does not inherit the Integrations list's heading while it loads. */
export default function MemberSecretsLoading() {
  return (
    <PageSurface>
      <IntegrationsPage>
        <LoadingRows label='Loading secrets…' />
      </IntegrationsPage>
    </PageSurface>
  )
}

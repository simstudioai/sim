import { IntegrationsPage } from '@/platform/app/(shell)/integrations/_components/integrations-page/integrations-page'
import { LoadingRows } from '@/platform/design-system/components'
import { PageSurface } from '@/platform/design-system/components/surface/surface'

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

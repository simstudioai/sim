import { ChipLink } from '@sim/emcn'
import type { Metadata } from 'next'
import { StatusPage } from '@/components/status-page'

export const metadata: Metadata = {
  title: 'Page Not Found',
  robots: { index: false, follow: true },
}

export default function IntegrationsNotFound() {
  return (
    <StatusPage
      title='Integration not found'
      description="The integration you're looking for doesn't exist or has been moved."
    >
      <ChipLink variant='primary' href='/integrations'>
        Browse integrations
      </ChipLink>
    </StatusPage>
  )
}

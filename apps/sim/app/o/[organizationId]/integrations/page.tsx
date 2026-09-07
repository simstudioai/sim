import { Suspense } from 'react'
import type { Metadata } from 'next'
import { OrganizationIntegrations } from '@/app/o/[organizationId]/integrations/integrations'
import Loading from '@/app/o/[organizationId]/integrations/loading'

export const metadata: Metadata = {
  title: 'Integrations',
}

export default function OrganizationIntegrationsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <OrganizationIntegrations />
    </Suspense>
  )
}

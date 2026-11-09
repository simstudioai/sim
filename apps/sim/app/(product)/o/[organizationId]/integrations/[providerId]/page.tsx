import type { Metadata } from 'next'
import { resolvePlatformMode } from '@/platform/lib/data/mode'

export const metadata: Metadata = { title: 'Integrations' }

export default async function Page({
  params,
  searchParams,
}: PageProps<'/integrations/[providerId]'>) {
  const section = (await params).providerId
  // Loaded only behind its mode, so a fixture server never evaluates the data seam.
  if (resolvePlatformMode() === 'live') {
    const { LiveIntegrationsRoute } = await import(
      '@/app/(product)/o/[organizationId]/integrations/_components/integrations-page/live-integrations-route'
    )
    return <LiveIntegrationsRoute section={section} />
  }
  const { IntegrationsRoute } = await import(
    '@/app/(product)/o/[organizationId]/integrations/_components/fixtures/integrations-page/integrations-route'
  )
  return <IntegrationsRoute section={section} searchParams={searchParams} />
}

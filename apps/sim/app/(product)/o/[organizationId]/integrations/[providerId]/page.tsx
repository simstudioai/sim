import type { Metadata } from 'next'
import { resolvePlatformMode } from '@/platform/lib/data/mode'
import type { ProductPageProps } from '@/platform/lib/route-props'

export const metadata: Metadata = { title: 'Integrations' }

export default async function Page({
  params,
  searchParams,
}: ProductPageProps<{ organizationId: string; providerId: string }>) {
  const section = (await params).providerId
  // Loaded only behind its mode, so a fixture server never evaluates the data seam.
  if (resolvePlatformMode() === 'live') {
    const { LiveIntegrationsRoute } = await import(
      '@/app/(product)/o/[organizationId]/integrations/_components/integrations-page/live-integrations-route'
    )
    return <LiveIntegrationsRoute section={section} searchParams={await searchParams} />
  }
  const { IntegrationsRoute } = await import(
    '@/app/(product)/o/[organizationId]/integrations/_components/fixtures/integrations-page/integrations-route'
  )
  return <IntegrationsRoute section={section} searchParams={searchParams} />
}

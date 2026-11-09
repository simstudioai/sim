import type { Metadata } from 'next'
import { resolvePlatformMode } from '@/platform/lib/data/mode'

export const metadata: Metadata = { title: 'Integrations' }

export default async function Page({ searchParams }: PageProps<'/integrations'>) {
  // Loaded only behind its mode, so a fixture server never evaluates the data seam.
  if (resolvePlatformMode() === 'live') {
    const { LiveIntegrationsRoute } = await import(
      '@/app/(product)/o/[organizationId]/integrations/_components/integrations-page/live-integrations-route'
    )
    return <LiveIntegrationsRoute />
  }
  const { IntegrationsRoute } = await import(
    '@/app/(product)/o/[organizationId]/integrations/_components/fixtures/integrations-page/integrations-route'
  )
  return <IntegrationsRoute searchParams={searchParams} />
}

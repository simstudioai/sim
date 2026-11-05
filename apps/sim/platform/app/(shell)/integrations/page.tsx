import { resolvePlatformMode } from '@/platform/lib/data/mode'

export default async function Page({ searchParams }: PageProps<'/integrations'>) {
  // Loaded only behind its mode, so a fixture server never evaluates the data seam.
  if (resolvePlatformMode() === 'live') {
    const { LiveIntegrationsRoute } = await import(
      '@/platform/app/(shell)/integrations/_components/integrations-page/live-integrations-route'
    )
    return <LiveIntegrationsRoute />
  }
  const { IntegrationsRoute } = await import(
    '@/platform/app/(shell)/integrations/_components/fixtures/integrations-page/integrations-route'
  )
  return <IntegrationsRoute searchParams={searchParams} />
}

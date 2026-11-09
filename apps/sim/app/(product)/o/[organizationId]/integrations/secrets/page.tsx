import type { Metadata } from 'next'
import { resolvePlatformMode } from '@/platform/lib/data/mode'
import type { ProductPageProps } from '@/platform/lib/route-props'

export const metadata: Metadata = { title: 'Generic Secrets' }

export default async function Page({ searchParams }: ProductPageProps<{ organizationId: string }>) {
  // Loaded only behind its mode, so a fixture server never evaluates the data seam.
  if (resolvePlatformMode() === 'live') {
    const { LiveMemberSecretsRoute } = await import(
      '@/app/(product)/o/[organizationId]/integrations/_components/member-secrets/live-member-secrets-route'
    )
    return <LiveMemberSecretsRoute searchParams={await searchParams} />
  }
  const { IntegrationsRoute } = await import(
    '@/app/(product)/o/[organizationId]/integrations/_components/fixtures/integrations-page/integrations-route'
  )
  return <IntegrationsRoute section='secrets' searchParams={searchParams} />
}

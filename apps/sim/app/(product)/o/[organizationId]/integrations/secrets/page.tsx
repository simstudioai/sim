import type { Metadata } from 'next'
import type { ProductPageProps } from '@/platform/lib/route-props'

export const metadata: Metadata = { title: 'Generic Secrets' }

export default async function Page({ searchParams }: ProductPageProps<{ organizationId: string }>) {
  // Inlined at build time, so a normal build carries neither this branch nor the example data.
  if (process.env.SIM_PLATFORM_FIXTURES === '1') {
    const { IntegrationsRoute } = await import(
      '@/app/(product)/o/[organizationId]/integrations/_components/fixtures/integrations-page/integrations-route'
    )
    return <IntegrationsRoute section='secrets' searchParams={searchParams} />
  }
  // Loaded only here, so a fixture build never evaluates the data seam.
  const { LiveMemberSecretsRoute } = await import(
    '@/app/(product)/o/[organizationId]/integrations/_components/member-secrets/live-member-secrets-route'
  )
  return <LiveMemberSecretsRoute searchParams={await searchParams} />
}

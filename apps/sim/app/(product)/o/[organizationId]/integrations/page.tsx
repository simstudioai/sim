import type { Metadata } from 'next'
import type { ProductPageProps } from '@/platform/lib/route-props'

/** A Slack onboarding token rides in the query, so it never leaves in a Referer. */
export const metadata: Metadata = { title: 'Integrations', referrer: 'no-referrer' }

export default async function Page({ searchParams }: ProductPageProps<{ organizationId: string }>) {
  // Inlined at build time, so a normal build carries neither this branch nor the example data.
  if (process.env.SIM_PLATFORM_FIXTURES === '1') {
    const { IntegrationsRoute } = await import(
      '@/app/(product)/o/[organizationId]/integrations/_components/fixtures/integrations-page/integrations-route'
    )
    return <IntegrationsRoute searchParams={searchParams} />
  }
  // Loaded only here, so a fixture build never evaluates the data seam.
  const { LiveIntegrationsRoute } = await import(
    '@/app/(product)/o/[organizationId]/integrations/_components/integrations-page/live-integrations-route'
  )
  return <LiveIntegrationsRoute searchParams={await searchParams} />
}

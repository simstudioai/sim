import type { Metadata } from 'next'
import { readScenario } from '@/platform/lib/navigation'
import type { ProductPageProps } from '@/platform/lib/route-props'

export const metadata: Metadata = { title: 'Home' }

export default async function Page({ searchParams }: ProductPageProps<{ organizationId: string }>) {
  const query = await searchParams
  // Inlined at build time, so a normal build carries neither this branch nor the example data.
  if (process.env.SIM_PLATFORM_FIXTURES === '1') {
    const [{ FixtureHome }, { loadConversationData, loadHomeRecentLinks }] = await Promise.all([
      import('@/app/(product)/o/[organizationId]/home/_components/fixture-home/fixture-home'),
      import('@/platform/fixtures'),
    ])
    const scenario = readScenario(query.state)
    const [data, recentLinks] = await Promise.all([
      loadConversationData(scenario),
      loadHomeRecentLinks(scenario),
    ])
    return <FixtureHome data={data.home} recentLinks={recentLinks} workspaces={data.workspaces} />
  }
  // Loaded only here, so a fixture build never evaluates the data seam.
  const { LiveHomeRoute } = await import(
    '@/app/(product)/o/[organizationId]/home/_components/live-home/live-home-route'
  )
  return <LiveHomeRoute searchParams={query} />
}

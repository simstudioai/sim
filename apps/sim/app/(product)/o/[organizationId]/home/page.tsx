import type { Metadata } from 'next'
import { FixtureHome } from '@/app/(product)/o/[organizationId]/home/_components/fixture-home/fixture-home'
import { loadConversationData, loadHomeRecentLinks } from '@/platform/fixtures'
import { resolvePlatformMode } from '@/platform/lib/data/mode'
import { readScenario } from '@/platform/lib/navigation'
import type { ProductPageProps } from '@/platform/lib/route-props'

export const metadata: Metadata = { title: 'Home' }

export default async function Page({ searchParams }: ProductPageProps<{ organizationId: string }>) {
  if (resolvePlatformMode() === 'live') {
    // Loaded only here, so a fixture server never evaluates the data seam.
    const { LiveHomeRoute } = await import(
      '@/app/(product)/o/[organizationId]/home/_components/live-home/live-home-route'
    )
    return <LiveHomeRoute />
  }
  const query = await searchParams
  const scenario = readScenario(query.state)
  const [data, recentLinks] = await Promise.all([
    loadConversationData(scenario),
    loadHomeRecentLinks(scenario),
  ])
  return <FixtureHome data={data?.home ?? null} recentLinks={recentLinks ?? []} />
}

import type { Metadata } from 'next'
import { FixtureHome } from '@/platform/app/(shell)/home/_components/fixture-home/fixture-home'
import { readScenario } from '@/platform/design-system/navigation'
import { loadConversationData, loadHomeRecentLinks } from '@/platform/fixtures'
import { resolvePlatformMode } from '@/platform/lib/data/mode'

export const metadata: Metadata = { title: 'Home' }

export default async function Page({ searchParams }: PageProps<'/home'>) {
  if (resolvePlatformMode() === 'live') {
    // Loaded only here, so a fixture server never evaluates the data seam.
    const { LiveHomeRoute } = await import(
      '@/platform/app/(shell)/home/_components/live-home/live-home-route'
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

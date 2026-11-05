import { HomeDashboard } from '@/platform/app/(shell)/home/_components/home-dashboard/home-dashboard'
import { readScenario } from '@/platform/design-system/navigation'
import { loadConversationData, loadHomeRecentLinks } from '@/platform/fixtures'

export default async function Page({ searchParams }: PageProps<'/home'>) {
  const query = await searchParams
  const scenario = readScenario(query.state)
  const [data, recentLinks] = await Promise.all([
    loadConversationData(scenario),
    loadHomeRecentLinks(scenario),
  ])
  return <HomeDashboard data={data?.home ?? null} recentLinks={recentLinks ?? []} />
}

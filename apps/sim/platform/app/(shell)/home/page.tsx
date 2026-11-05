import { ProductFrame, readScenario } from '@/platform/app/(shell)/_components/product-frame'
import { HomeDashboard } from '@/platform/app/(shell)/home/_components/home-dashboard/home-dashboard'
import { loadConversationData, loadShellData } from '@/platform/fixtures'

export default async function Page({ searchParams }: PageProps<'/home'>) {
  const query = await searchParams
  const scenario = readScenario(query)
  const [data, shell] = await Promise.all([loadConversationData(scenario), loadShellData(scenario)])
  return (
    <ProductFrame query={query} shell={shell}>
      <HomeDashboard data={data?.home ?? null} />
    </ProductFrame>
  )
}

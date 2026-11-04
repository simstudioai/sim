import { ProductFrame, readScenario } from '@/platform/app/(shell)/_components/product-frame'
import { HomeScreen } from '@/platform/design-system/features/home/home-screen'
import { loadConversationData, loadShellData } from '@/platform/fixtures'

export default async function Page({ searchParams }: PageProps<'/home'>) {
  const query = await searchParams
  const scenario = readScenario(query)
  const [data, shell] = await Promise.all([loadConversationData(scenario), loadShellData(scenario)])
  return (
    <ProductFrame query={query} shell={shell}>
      <HomeScreen data={data?.home ?? null} />
    </ProductFrame>
  )
}

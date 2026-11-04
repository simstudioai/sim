import type { Metadata } from 'next'
import { loadPreviewData } from '@/platform/fixtures'
import { Workbench } from '@/platform/preview/workbench'

export const metadata: Metadata = {
  title: 'Platform component workbench',
  description: 'Browse Sim’s shared components, themes and Paper recipes.',
}

interface WorkbenchPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function Page({ searchParams }: WorkbenchPageProps) {
  const query = await searchParams
  const theme = query.theme === 'dark' ? 'dark' : 'light'
  const scenario = query.state === 'empty' || query.state === 'stress' ? query.state : 'full'
  const data = await loadPreviewData(scenario)
  return (
    <Workbench
      theme={theme}
      scenario={scenario}
      data={data}
      destination={typeof query.destination === 'string' ? Number(query.destination) || 0 : 0}
      recipe={typeof query.recipe === 'string' ? query.recipe : undefined}
    />
  )
}

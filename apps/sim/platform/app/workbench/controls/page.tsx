import type { Metadata } from 'next'
import { ControlsWorkbench } from '@/platform/preview/controls-workbench'

export const metadata: Metadata = {
  title: 'Platform form and data controls',
  description: 'Exercise the form, status and data table controls in either theme.',
}

interface ControlsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function Page({ searchParams }: ControlsPageProps) {
  const { theme } = await searchParams
  return <ControlsWorkbench theme={theme === 'dark' ? 'dark' : 'light'} />
}

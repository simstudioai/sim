import { Suspense } from 'react'
import type { Metadata } from 'next'
import { Dashboards } from '@/app/workspace/[workspaceId]/dashboards/dashboards'
import DashboardsLoading from '@/app/workspace/[workspaceId]/dashboards/loading'
export const metadata: Metadata = { title: 'Dashboards', robots: { index: false } }

interface DashboardsPageProps {
  params: Promise<{ workspaceId: string }>
}

export default async function DashboardsPage({ params }: DashboardsPageProps) {
  const { workspaceId } = await params
  return (
    <Suspense fallback={<DashboardsLoading />}>
      <Dashboards workspaceId={workspaceId} />
    </Suspense>
  )
}

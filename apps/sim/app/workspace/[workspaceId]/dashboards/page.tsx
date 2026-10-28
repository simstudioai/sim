import { Suspense } from 'react'
import type { Metadata } from 'next'
import { DashboardResource } from '@/components/dashboards/dashboard-resource'
import DashboardsLoading from '@/app/workspace/[workspaceId]/dashboards/loading'

export const metadata: Metadata = { title: 'Dashboard', robots: { index: false } }

interface DashboardsPageProps {
  params: Promise<{ workspaceId: string }>
}

export default async function DashboardsPage({ params }: DashboardsPageProps) {
  const { workspaceId } = await params
  return (
    <Suspense fallback={<DashboardsLoading />}>
      <DashboardResource workspaceId={workspaceId} />
    </Suspense>
  )
}

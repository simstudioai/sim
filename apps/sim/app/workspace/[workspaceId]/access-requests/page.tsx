import { Suspense } from 'react'
import type { Metadata } from 'next'
import { AccessRequestsLoading } from '@/ee/access-requests/components/access-requests-loading'
import { MyAccessRequests } from '@/ee/access-requests/components/my-access-requests'

export const metadata: Metadata = { title: 'My access requests' }

interface AccessRequestsPageProps {
  params: Promise<{ workspaceId: string }>
}

export default async function AccessRequestsPage({ params }: AccessRequestsPageProps) {
  const { workspaceId } = await params
  return (
    <Suspense fallback={<AccessRequestsLoading />}>
      <MyAccessRequests scope={{ kind: 'workspace', workspaceId }} />
    </Suspense>
  )
}

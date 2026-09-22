import { Suspense } from 'react'
import type { Metadata } from 'next'
import { AccessRequestsLoading } from '@/ee/access-requests/components/access-requests-loading'
import { MyAccessRequests } from '@/ee/access-requests/components/my-access-requests'

export const metadata: Metadata = { title: 'My access requests' }

interface OrganizationAccessRequestsPageProps {
  params: Promise<{ organizationId: string }>
}

export default async function OrganizationAccessRequestsPage({
  params,
}: OrganizationAccessRequestsPageProps) {
  const { organizationId } = await params
  return (
    <Suspense fallback={<AccessRequestsLoading />}>
      <MyAccessRequests scope={{ kind: 'organization', organizationId }} />
    </Suspense>
  )
}

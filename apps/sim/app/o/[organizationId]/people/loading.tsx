'use client'

import { Users } from '@sim/emcn/icons'
import { LoadingStatus } from '@/app/o/[organizationId]/people/loading-status'
import { Resource } from '@/app/workspace/[workspaceId]/components/resource/resource'

export default function PeopleLoading() {
  return (
    <Resource>
      <Resource.Header icon={Users} title='People' />
      <LoadingStatus>Loading people…</LoadingStatus>
    </Resource>
  )
}

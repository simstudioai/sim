import { Suspense } from 'react'
import type { Metadata } from 'next'
import Loading from '@/app/o/[organizationId]/workspaces/loading'
import { OrganizationWorkspaces } from '@/app/o/[organizationId]/workspaces/workspaces'

export const metadata: Metadata = {
  title: 'Workspaces',
}

export default function OrganizationWorkspacesPage() {
  return (
    <Suspense fallback={<Loading />}>
      <OrganizationWorkspaces />
    </Suspense>
  )
}

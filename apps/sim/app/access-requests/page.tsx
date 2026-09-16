import { Suspense } from 'react'
import { ChipLink } from '@sim/emcn'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createSearchParamsCache } from 'nuqs/server'
import { AccessRequestsLoading } from '@/components/access-requests/access-requests-loading'
import { MyAccessRequests } from '@/components/access-requests/my-access-requests'
import { OrganizationAccessRequests } from '@/components/access-requests/organization-access-requests'
import { accessRequestEntrySearchParams } from '@/components/access-requests/search-params'
import { EmptyState } from '@/components/empty-state/empty-state'
import { getSession } from '@/lib/auth'
import { WORKSPACES_PATH } from '@/lib/navigation/paths'
import { buildAuthCrossLink } from '@/app/(auth)/auth-redirect'

export const metadata: Metadata = {
  title: 'Access requests',
  robots: { index: false, follow: false },
}

interface AccessRequestsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const entrySearchParams = createSearchParamsCache(accessRequestEntrySearchParams)

/** Session-only entry so access requests remain reachable outside the organization Search rollout. */
export default async function AccessRequestsPage({ searchParams }: AccessRequestsPageProps) {
  const [rawParams, session] = await Promise.all([searchParams, getSession()])
  const params = entrySearchParams.parse(rawParams)
  const query = new URLSearchParams()
  if (params.organizationId) query.set('organizationId', params.organizationId)
  if (params.view !== 'requests') query.set('view', params.view)
  if (params.requestId) query.set('requestId', params.requestId)
  if (!session?.user) {
    redirect(
      buildAuthCrossLink('/login', {
        callbackUrl: `/access-requests?${query}`,
        isInviteFlow: false,
      })
    )
  }

  if (!params.organizationId) {
    return (
      <EmptyState
        title='Choose an organization'
        description='Open My access requests from your workspace menu.'
        action={<ChipLink href={WORKSPACES_PATH}>Your workspaces</ChipLink>}
      />
    )
  }

  return (
    <Suspense fallback={<AccessRequestsLoading />}>
      {params.view === 'admin' ? (
        <main className='min-h-screen bg-[var(--bg)] px-6 py-8'>
          <div className='mx-auto flex max-w-3xl flex-col gap-6'>
            <div className='flex items-center justify-between gap-4'>
              <h1 className='text-[var(--text-primary)] text-lg'>Access requests</h1>
              <ChipLink href={WORKSPACES_PATH}>Your workspaces</ChipLink>
            </div>
            <OrganizationAccessRequests organizationId={params.organizationId} standalone />
          </div>
        </main>
      ) : (
        <MyAccessRequests scope={{ kind: 'organization', organizationId: params.organizationId }} />
      )}
    </Suspense>
  )
}

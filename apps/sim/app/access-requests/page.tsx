import { Suspense } from 'react'
import { ChipLink } from '@sim/emcn'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createSearchParamsCache, createSerializer } from 'nuqs/server'
import { EmptyState } from '@/components/empty-state/empty-state'
import { getSession } from '@/lib/auth'
import { WORKSPACES_PATH } from '@/lib/navigation/paths'
import { buildAuthCrossLink } from '@/app/(auth)/auth-redirect'
import { AccessRequestsLoading } from '@/ee/access-requests/components/access-requests-loading'
import { MyAccessRequests } from '@/ee/access-requests/components/my-access-requests'
import { OrganizationAccessRequests } from '@/ee/access-requests/components/organization-access-requests'
import { accessRequestEntrySearchParams } from '@/ee/access-requests/components/search-params'

export const metadata: Metadata = {
  title: 'Access requests',
  robots: { index: false, follow: false },
}

interface AccessRequestsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const entrySearchParams = createSearchParamsCache(accessRequestEntrySearchParams)
const serializeEntrySearchParams = createSerializer(accessRequestEntrySearchParams)

/** Session-only entry so access requests remain reachable outside the organization Search rollout. */
export default async function AccessRequestsPage({ searchParams }: AccessRequestsPageProps) {
  const [rawParams, session] = await Promise.all([searchParams, getSession()])
  const params = entrySearchParams.parse(rawParams)
  if (!session?.user) {
    redirect(
      buildAuthCrossLink('/login', {
        callbackUrl: serializeEntrySearchParams('/access-requests', params),
        isInviteFlow: false,
      })
    )
  }

  if (!params.organizationId) {
    return (
      <EmptyState
        title='Choose an organization'
        description='Open My access requests from your profile menu in a workspace.'
        action={<ChipLink href={WORKSPACES_PATH}>Your workspaces</ChipLink>}
      />
    )
  }

  return (
    <Suspense fallback={<AccessRequestsLoading />}>
      {params.view === 'admin' ? (
        <main className='flex-1 px-6 py-8'>
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

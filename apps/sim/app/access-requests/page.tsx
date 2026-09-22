import { Suspense } from 'react'
import { ChipLink } from '@sim/emcn'
import { createLogger } from '@sim/logger'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createSearchParamsCache, createSerializer } from 'nuqs/server'
import { EmptyState } from '@/components/empty-state/empty-state'
import { getSession } from '@/lib/auth'
import { APP_ENTRY_PATH, organizationRoutes } from '@/lib/navigation/paths'
import { getOrganizationSurfaceContext } from '@/lib/organizations/surface'
import { buildAuthCrossLink } from '@/app/(auth)/auth-redirect'
import { AccessRequestsLoading } from '@/ee/access-requests/components/access-requests-loading'
import { MyAccessRequests } from '@/ee/access-requests/components/my-access-requests'
import { OrganizationAccessRequests } from '@/ee/access-requests/components/organization-access-requests'
import {
  accessRequestEntrySearchParams,
  accessRequestSearchParams,
} from '@/ee/access-requests/components/search-params'

export const metadata: Metadata = {
  title: 'Access requests',
  robots: { index: false, follow: false },
}

interface AccessRequestsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const entrySearchParams = createSearchParamsCache(accessRequestEntrySearchParams)
const serializeEntrySearchParams = createSerializer(accessRequestEntrySearchParams)
const serializeRequesterSearchParams = createSerializer(accessRequestSearchParams)
const logger = createLogger('AccessRequestsPage')

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
        description='Open My access requests from your profile menu in an organization or workspace.'
        action={<ChipLink href={APP_ENTRY_PATH}>Back to Sim</ChipLink>}
      />
    )
  }

  if (params.view !== 'admin') {
    const context = await getOrganizationSurfaceContext(
      params.organizationId,
      session.user.id
    ).catch((error) => {
      logger.warn('Unable to resolve organization navigation for access requests', { error })
      return null
    })
    if (context?.searchAccess.memberScoped) {
      redirect(
        serializeRequesterSearchParams(organizationRoutes(params.organizationId).accessRequests, {
          view: params.view,
          search: params.search,
          page: params.page,
          requestId: params.requestId,
        })
      )
    }
  }

  return (
    <Suspense fallback={<AccessRequestsLoading />}>
      {params.view === 'admin' ? (
        <main className='flex-1 px-6 py-8'>
          <div className='mx-auto flex max-w-3xl flex-col gap-6'>
            <div className='flex items-center justify-between gap-4'>
              <h1 className='text-[var(--text-primary)] text-lg'>Access requests</h1>
              <ChipLink href={APP_ENTRY_PATH}>Back to Sim</ChipLink>
            </div>
            <OrganizationAccessRequests organizationId={params.organizationId} standalone />
          </div>
        </main>
      ) : (
        <MyAccessRequests
          scope={{ kind: 'organization', organizationId: params.organizationId }}
          standalone
        />
      )}
    </Suspense>
  )
}

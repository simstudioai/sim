import { Suspense } from 'react'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { isOrganizationFeatureEntitled } from '@/lib/billing/core/subscription'
import { isUsageMonitoringEnabled } from '@/lib/core/config/env-flags'
import { getWorkspaceHostContextForViewer } from '@/lib/workspaces/host-context'
import UsageEventsLoading from '@/app/workspace/[workspaceId]/settings/usage/events/loading'
import { UsageEventsView } from '@/ee/organization-usage/components/usage-events-view'

export const metadata: Metadata = {
  title: 'Usage events',
}

interface UsageEventsPageProps {
  params: Promise<{ workspaceId: string }>
}

/**
 * This route sits outside `[section]`, so it inherits none of that page's gates and
 * has to repeat them: a host organization, an org-admin viewer, and the enterprise
 * entitlement. The API refuses regardless; this keeps a deep link from rendering a
 * shell the viewer can never fill.
 */
export default async function UsageEventsPage({ params }: UsageEventsPageProps) {
  const session = await getSession()
  if (!session?.user) redirect('/login')

  const { workspaceId } = await params
  const hostContext = await getWorkspaceHostContextForViewer(workspaceId, session.user.id)
  const organizationId = hostContext?.hostOrganizationId
  if (!hostContext || !organizationId || !hostContext.viewer.isHostOrganizationAdmin) {
    redirect(`/workspace/${workspaceId}/settings/general`)
  }
  if (!(await isOrganizationFeatureEntitled(organizationId, isUsageMonitoringEnabled))) {
    redirect(`/workspace/${workspaceId}/settings/general`)
  }

  return (
    <Suspense fallback={<UsageEventsLoading />}>
      <UsageEventsView
        organizationId={organizationId}
        backHref={`/workspace/${workspaceId}/settings/usage`}
      />
    </Suspense>
  )
}

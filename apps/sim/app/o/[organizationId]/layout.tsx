import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { getActiveOrganizationId } from '@/lib/auth/session-response'
import { isChatEnabled } from '@/lib/core/config/env-flags'
import { organizationRoutes, WORKSPACE_SETTINGS_PATH } from '@/lib/navigation/paths'
import { getOrganizationSurfaceContext } from '@/lib/organizations/surface'
import { getQueryClient } from '@/app/_shell/providers/get-query-client'
import { buildAuthCrossLink } from '@/app/(auth)/auth-redirect'
import { OrganizationAccessDenied } from '@/app/o/[organizationId]/components/organization-access-denied'
import { OrganizationSidebar } from '@/app/o/[organizationId]/components/organization-sidebar'
import { prefetchOrganizationSidebar } from '@/app/o/[organizationId]/prefetch'
import { OrganizationProvider } from '@/app/o/[organizationId]/providers/organization-provider'
import { ImpersonationBanner } from '@/app/workspace/[workspaceId]/components/impersonation-banner'
import { SessionExpired } from '@/app/workspace/[workspaceId]/components/session-expired'
import { WorkspaceChrome } from '@/app/workspace/[workspaceId]/components/workspace-chrome'
import { GlobalCommandsProvider } from '@/app/workspace/[workspaceId]/providers/global-commands-provider'

/**
 * The organization surface: the viewer's own view of one organization, outside
 * any workspace. Requires membership and the organization's Search rollout.
 * Non-members get an explicit denial; members outside the rollout retain
 * workspace settings, including when following a saved organization link.
 */
export default async function OrganizationLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ organizationId: string }>
}) {
  const { organizationId } = await params
  const session = await getSession()
  if (!session?.user) {
    redirect(
      buildAuthCrossLink('/login', {
        callbackUrl: organizationRoutes(organizationId).root,
        isInviteFlow: false,
      })
    )
  }

  const queryClient = getQueryClient()
  const [context, cookieStore] = await Promise.all([
    getOrganizationSurfaceContext(organizationId, session.user.id),
    cookies(),
  ])
  if (!context) {
    return <OrganizationAccessDenied />
  }
  if (!context.searchAccess.memberScoped) redirect(WORKSPACE_SETTINGS_PATH)

  await prefetchOrganizationSidebar(
    queryClient,
    organizationId,
    { kind: 'session', userId: session.user.id, sessionId: session.session.id },
    getActiveOrganizationId(session)
  )

  const initialSidebarCollapsed = cookieStore.get('sidebar_collapsed')?.value === '1'

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <OrganizationProvider context={context} chatEnabled={isChatEnabled}>
        <GlobalCommandsProvider>
          <div className='workspace-root flex h-screen w-full flex-col overflow-hidden bg-[var(--surface-1)]'>
            <ImpersonationBanner />
            <SessionExpired />
            <WorkspaceChrome
              sidebar={<OrganizationSidebar />}
              initialSidebarCollapsed={initialSidebarCollapsed}
            >
              {children}
            </WorkspaceChrome>
          </div>
        </GlobalCommandsProvider>
      </OrganizationProvider>
    </HydrationBoundary>
  )
}

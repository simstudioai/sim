import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { organizationRoutes, WORKSPACE_SETTINGS_PATH } from '@/lib/navigation/paths'
import { getOrganizationSurfaceContext } from '@/lib/organizations/surface'
import { prefetchUserProfile } from '@/lib/users/prefetch-user-profile'
import { getQueryClient } from '@/app/_shell/providers/get-query-client'
import { buildAuthCrossLink } from '@/app/(auth)/auth-redirect'
import { OrganizationAccessDenied } from '@/app/o/[organizationId]/components/organization-access-denied'
import { OrganizationSidebar } from '@/app/o/[organizationId]/components/organization-sidebar'
import { OrganizationProvider } from '@/app/o/[organizationId]/providers/organization-provider'
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
    /* The rail's footer renders the viewer, so the profile is layout data: seeded
       here it paints hydrated, and a page hydrating the same key beneath finds it
       populated rather than an empty query it cannot fill during render. */
    prefetchUserProfile(queryClient, session.user.id),
  ])
  if (!context) {
    return <OrganizationAccessDenied />
  }
  if (!context.searchAccess.memberScoped) redirect(WORKSPACE_SETTINGS_PATH)

  const initialSidebarCollapsed = cookieStore.get('sidebar_collapsed')?.value === '1'

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <OrganizationProvider context={context}>
        <GlobalCommandsProvider>
          <div className='workspace-root flex h-screen w-full flex-col overflow-hidden bg-[var(--surface-1)]'>
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

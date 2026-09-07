import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { organizationRoutes } from '@/lib/navigation/paths'
import { getOrganizationSurfaceContext } from '@/lib/organizations/surface'
import { buildAuthCrossLink } from '@/app/(auth)/auth-redirect'
import { OrganizationAccessDenied } from '@/app/o/[organizationId]/components/organization-access-denied'
import { OrganizationSidebar } from '@/app/o/[organizationId]/components/organization-sidebar'
import { OrganizationProvider } from '@/app/o/[organizationId]/providers/organization-provider'
import { WorkspaceChrome } from '@/app/workspace/[workspaceId]/components/workspace-chrome'
import { GlobalCommandsProvider } from '@/app/workspace/[workspaceId]/providers/global-commands-provider'

/**
 * The organization surface: the viewer's own view of one organization, outside
 * any workspace. Membership in the routed organization is the whole gate — a
 * non-member gets an explicit denial rather than a redirect, so a stale link
 * never bounces someone into a different organization.
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
        callbackUrl: organizationRoutes(organizationId).home,
        isInviteFlow: false,
      })
    )
  }

  const [context, cookieStore] = await Promise.all([
    getOrganizationSurfaceContext(organizationId, session.user.id),
    cookies(),
  ])
  if (!context) {
    return <OrganizationAccessDenied />
  }

  const initialSidebarCollapsed = cookieStore.get('sidebar_collapsed')?.value === '1'

  return (
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
  )
}

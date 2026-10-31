import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { getActiveOrganizationId } from '@/lib/auth/session-response'
import {
  getOrganizationSurfaceContext,
  resolveOrganizationLanding,
} from '@/lib/organizations/surface'
import { ExtensionWorkspaces } from '@/app/extension/workspaces'

export default async function ExtensionPage() {
  const session = await getSession()
  if (session?.user) {
    const organizationId = await resolveOrganizationLanding(
      session.user.id,
      getActiveOrganizationId(session)
    )
    if (organizationId) {
      const context = await getOrganizationSurfaceContext(organizationId, session.user.id)
      if (context?.mothershipAvailable && (context.canBuild || context.searchAccess.memberScoped)) {
        redirect(`/extension/o/${encodeURIComponent(organizationId)}`)
      }
    }
  }
  return <ExtensionWorkspaces />
}

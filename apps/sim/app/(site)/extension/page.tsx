import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { getActiveOrganizationId } from '@/lib/auth/session-response'
import { getOrganizationSurfaceGate, resolveOrganizationLanding } from '@/lib/organizations/surface'
import { ExtensionWorkspaces } from '@/app/(site)/extension/workspaces'

/**
 * Opens the viewer's team Assistant when they can use it, and the workspace picker otherwise. A
 * personal organization stands in for having no team, which has always opened the picker.
 */
export default async function ExtensionPage() {
  const session = await getSession()
  if (session?.user) {
    const organizationId = await resolveOrganizationLanding(
      session.user.id,
      getActiveOrganizationId(session)
    )
    if (organizationId) {
      const gate = await getOrganizationSurfaceGate(organizationId, session.user.id)
      if (gate?.organization.kind === 'team' && gate.mothershipAvailable) {
        redirect(`/extension/o/${encodeURIComponent(organizationId)}`)
      }
    }
  }
  return <ExtensionWorkspaces />
}

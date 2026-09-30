import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { getActiveOrganizationId } from '@/lib/auth/session-response'
import {
  getOrganizationSurfaceContext,
  resolveOrganizationLanding,
} from '@/lib/organizations/surface'
import { buildAuthCrossLink } from '@/app/(auth)/auth-redirect'
import { OrganizationIntegrations } from '@/app/o/[organizationId]/integrations/integrations'
import { OrganizationProvider } from '@/app/o/[organizationId]/providers/organization-provider'
import { protoRoutes } from '@/app/playground/org/lib/routes'

/**
 * Connectors: the organization's own integrations page (the viewer's connected accounts),
 * loaded and rendered the way `/o/[organizationId]/integrations` does, inside the org rail.
 */
export default async function ConnectorsPage() {
  const session = await getSession()
  if (!session?.user)
    redirect(
      buildAuthCrossLink('/login', { callbackUrl: protoRoutes.connectors, isInviteFlow: false })
    )
  /** The session's active organization, else the first the viewer belongs to, as the app entry does. */
  const organizationId = await resolveOrganizationLanding(
    session.user.id,
    getActiveOrganizationId(session)
  )
  const context = organizationId
    ? await getOrganizationSurfaceContext(organizationId, session.user.id)
    : null
  if (!context?.searchAccess.memberScoped)
    return (
      <div className='flex h-full flex-col items-center justify-center gap-2'>
        <h1 className='text-[20px] text-[var(--text-primary)]'>Connectors</h1>
        <p className='text-[var(--text-muted)] text-small'>
          {organizationId
            ? 'Sim Search is not enabled for this organization.'
            : 'You are not a member of an organization.'}
        </p>
      </div>
    )
  return (
    <OrganizationProvider context={context}>
      <Suspense
        fallback={<p className='p-6 text-[var(--text-muted)] text-caption'>Loading connectors…</p>}
      >
        <OrganizationIntegrations />
      </Suspense>
    </OrganizationProvider>
  )
}

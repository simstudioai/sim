import { Suspense } from 'react'
import { getSession } from '@/lib/auth'
import { getActiveOrganizationId } from '@/lib/auth/session-response'
import {
  getOrganizationSurfaceContext,
  type OrganizationSurfaceContext,
  resolveOrganizationLanding,
} from '@/lib/organizations/surface'
import { ProtoPage } from '@/app/playground/org/components/proto-page'

/** The organization the home page chats in, resolved the way the app entry picks one. */
async function resolveHomeOrganization(): Promise<OrganizationSurfaceContext | null> {
  const session = await getSession()
  if (!session?.user) return null
  const organizationId = await resolveOrganizationLanding(
    session.user.id,
    getActiveOrganizationId(session)
  )
  return organizationId ? getOrganizationSurfaceContext(organizationId, session.user.id) : null
}

export default async function OrgPrototypePage({
  params,
}: {
  params: Promise<{ slug?: string[] }>
}) {
  const { slug } = await params
  const organization = slug?.length ? null : await resolveHomeOrganization()
  return (
    <Suspense
      fallback={<p className='p-6 text-[var(--text-muted)] text-caption'>Loading prototype…</p>}
    >
      <ProtoPage slug={slug} organization={organization} />
    </Suspense>
  )
}

import { ChipLink, StatusPageContent } from '@sim/emcn'
import { getSession } from '@/lib/auth'
import { getOrganizationSurfaceContext } from '@/lib/organizations/surface'
import { resolveSimLinkOrganization } from '@/lib/sim-links/application/organization'
import { LinkDraft } from '@/app/extension/create-link/link-draft'

export default async function CreateLinkPage() {
  const session = await getSession()
  if (!session?.user) return null
  const id = await resolveSimLinkOrganization({
    kind: 'session',
    userId: session.user.id,
    sessionId: session.session.id,
  })
  const context = id && (await getOrganizationSurfaceContext(id, session.user.id))
  if (!context)
    return (
      <StatusPageContent
        title='Links unavailable'
        description='Your organization needs Links enabled to create a link.'
      >
        <ChipLink href='/home'>Open Sim</ChipLink>
      </StatusPageContent>
    )
  return (
    <LinkDraft organization={{ id: context.organization.id, name: context.organization.name }} />
  )
}

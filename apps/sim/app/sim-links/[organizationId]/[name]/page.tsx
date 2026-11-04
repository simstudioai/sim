import { ChipLink, StatusPageContent } from '@sim/emcn'
import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { organizationRoutes } from '@/lib/navigation/paths'
import { resolveSimLinkOrganization } from '@/lib/sim-links/application/organization'
import { resolveSimLink } from '@/lib/sim-links/application/use-cases'
import { simLinkNameSchema } from '@/lib/sim-links/validation'
import { buildAuthCrossLink } from '@/app/(auth)/auth-redirect'

interface OrganizationLinkPageProps {
  params: Promise<{ organizationId: string; name: string }>
}

/** Bookmarks stay in their exporting organization even after the browser's active team changes. */
export default async function OrganizationLinkPage({ params }: OrganizationLinkPageProps) {
  const { organizationId, name: encodedName } = await params
  const name = decodeURIComponent(encodedName)
  if (!simLinkNameSchema.safeParse(name).success) notFound()
  const routes = organizationRoutes(organizationId)
  const session = await getSession()
  if (!session?.user)
    redirect(
      buildAuthCrossLink('/login', {
        callbackUrl: routes.openSimLink(name),
        isInviteFlow: false,
      })
    )
  const principal = {
    kind: 'session',
    userId: session.user.id,
    sessionId: session.session.id,
  } as const
  if ((await resolveSimLinkOrganization(principal)) !== organizationId) notFound()
  const result = await resolveSimLink.execute({
    principal,
    input: { organizationId, name, values: [], query: '' },
  })
  if (result.kind === 'redirect') redirect(result.url)
  return (
    <StatusPageContent
      title={`sim/${name}`}
      description={
        result.kind === 'missing_values'
          ? 'This link needs a value. Open it from Links.'
          : 'This link is unavailable.'
      }
    >
      <ChipLink href={routes.simLinks}>Open Links</ChipLink>
    </StatusPageContent>
  )
}

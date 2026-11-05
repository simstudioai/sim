import { ChipLink, StatusPageContent } from '@sim/emcn'
import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { organizationRoutes } from '@/lib/navigation/paths'
import { resolveSimLink } from '@/lib/sim-links/application/use-cases'
import { simLinkNameSchema } from '@/lib/sim-links/validation'
import { buildAuthCrossLink } from '@/app/(auth)/auth-redirect'
import { LogoShell } from '@/app/(landing)/components/logo-shell'

interface OrganizationLinkPageProps {
  params: Promise<{ organizationId: string; name: string }>
}

/** A link in one named organization, whichever organization the session is currently active in. */
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
  const result = await resolveSimLink
    .execute({
      principal: { kind: 'session', userId: session.user.id, sessionId: session.session.id },
      input: { organizationId, name, values: [], query: '' },
    })
    .catch((error: unknown) => {
      if (error instanceof OrchestrationError) return null
      throw error
    })
  if (!result) notFound()
  if (result.kind === 'redirect') redirect(result.url)
  return (
    <LogoShell center theme='inherit'>
      <StatusPageContent
        title={name}
        description={
          result.kind === 'missing_values'
            ? 'This link needs a value. Open it from Links.'
            : 'This link is unavailable.'
        }
      >
        <ChipLink href={routes.simLinks}>Open Links</ChipLink>
      </StatusPageContent>
    </LogoShell>
  )
}

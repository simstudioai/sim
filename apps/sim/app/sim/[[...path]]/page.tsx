import { ChipLink, StatusPageContent } from '@sim/emcn'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { getActiveOrganizationId } from '@/lib/auth/session-response'
import { organizationRoutes, simLinkPath } from '@/lib/navigation/paths'
import { resolveOrganizationLanding } from '@/lib/organizations/surface'
import { resolveSimLink } from '@/lib/sim-links/application/use-cases'
import { isSimLinksEnabled } from '@/lib/sim-links/feature-flag'
import { simLinkNameSchema } from '@/lib/sim-links/validation'
import { buildAuthCrossLink } from '@/app/(auth)/auth-redirect'
import { LogoShell } from '@/app/(landing)/components/logo-shell'
import { serializeSimLinkView } from '@/app/o/[organizationId]/links/search-params'

export const metadata: Metadata = {
  title: 'Sim link',
  robots: { index: false, follow: false },
}

interface SimLinkPageProps {
  params: Promise<{ path?: string[] }>
}

/**
 * The typed `sim/<name>/<values…>` path as plain text. Next passes catch-all segments still
 * percent-encoded (it already rejects malformed escapes with a 400), and a browser site-search
 * shortcut encodes `/` inside a single segment.
 */
function decodeSimLinkPath(path: string[]): string[] {
  return path.flatMap((segment) => decodeURIComponent(segment).split('/')).filter(Boolean)
}

/**
 * Where `sim/<name>/<values…>` lands: the viewer's organization link's destination,
 * or a page that offers to create the link when nobody has yet.
 */
export default async function SimLinkPage({ params }: SimLinkPageProps) {
  const { path = [] } = await params
  const segments = decodeSimLinkPath(path)
  const session = await getSession()
  if (!session?.user)
    redirect(
      buildAuthCrossLink('/login', {
        callbackUrl: simLinkPath(...segments),
        isInviteFlow: false,
      })
    )
  const organizationId = await resolveOrganizationLanding(
    session.user.id,
    getActiveOrganizationId(session)
  )
  if (!organizationId || !(await isSimLinksEnabled(organizationId))) notFound()
  const library = organizationRoutes(organizationId).simLinks
  const [name, ...values] = segments
  if (!name) redirect(library)

  const result = await resolveSimLink.execute({
    principal: { kind: 'session', userId: session.user.id, sessionId: session.session.id },
    input: { organizationId, name, values },
  })
  if (result.kind === 'redirect') redirect(result.url)

  const creatable = result.kind === 'not_found' && simLinkNameSchema.safeParse(name).success
  return (
    <LogoShell center theme='inherit'>
      <StatusPageContent
        title={`sim/${name}`}
        description={
          result.kind === 'missing_values'
            ? `This link needs ${result.required === 1 ? 'a value' : `${result.required} values`}, like sim/${name}/${Array.from({ length: result.required }, () => 'value').join('/')}.`
            : "This Sim link doesn't exist yet."
        }
      >
        {creatable && (
          <ChipLink variant='primary' href={serializeSimLinkView(library, { create: name })}>
            Create sim/{name}
          </ChipLink>
        )}
        <ChipLink href={library}>All Sim links</ChipLink>
      </StatusPageContent>
    </LogoShell>
  )
}

import { ChipLink, StatusPageContent } from '@sim/emcn'
import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { organizationRoutes, simLinkPath } from '@/lib/navigation/paths'
import { resolveSimLinkOrganization } from '@/lib/sim-links/application/organization'
import { resolveSimLink, type SimLinkResolution } from '@/lib/sim-links/application/use-cases'
import { SIM_LINK_QUERY_HEADER } from '@/lib/sim-links/typed-query'
import { parseTypedSimLink, simLinkNameSchema } from '@/lib/sim-links/validation'
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
 * percent-encoded (it already rejects malformed escapes with a 400). A browser site-search
 * shortcut sends `sim jira/123` as one segment with its `/` encoded, so only a lone segment is
 * split; separately typed values keep any `/` they contain.
 */
function decodeSimLinkPath(path: string[]): string[] {
  const segments = path.map(decodeURIComponent)
  return segments.length === 1 ? segments[0].split('/').filter(Boolean) : segments
}

/**
 * Why a link did not redirect. Only a valid link name is echoed back, so an arbitrary path
 * can't put its own text on this page.
 */
function describeUnresolved(result: SimLinkResolution, validName: boolean, name: string): string {
  if (result.kind === 'missing_values') {
    const example = Array.from({ length: result.required }, () => 'value').join('/')
    const needed = result.required === 1 ? 'a value' : `${result.required} values`
    return `This link needs ${needed}, like sim/${name}/${example}.`
  }
  if (result.kind === 'invalid_values') return "Sim links can't open . or .. as a value."
  return validName ? "This Sim link doesn't exist yet." : "That isn't a valid Sim link name."
}

/**
 * Where `sim/<name>/<values…>?<query>` lands: the viewer's organization link's destination,
 * or a page that offers to create the link when nobody has yet.
 */
export default async function SimLinkPage({ params }: SimLinkPageProps) {
  const [{ path = [] }, requestHeaders] = await Promise.all([params, headers()])
  const query = requestHeaders.get(SIM_LINK_QUERY_HEADER) ?? ''
  const segments = decodeSimLinkPath(path)
  const session = await getSession()
  if (!session?.user)
    redirect(
      buildAuthCrossLink('/login', {
        callbackUrl: `${simLinkPath(...segments)}${query ? `?${query}` : ''}`,
        isInviteFlow: false,
      })
    )
  const principal = {
    kind: 'session',
    userId: session.user.id,
    sessionId: session.session.id,
  } as const
  const organizationId = await resolveSimLinkOrganization(principal)
  if (!organizationId) notFound()
  const library = organizationRoutes(organizationId).simLinks
  const { name, values } = parseTypedSimLink(segments)
  if (!name) redirect(library)

  const result = await resolveSimLink.execute({
    principal,
    input: { organizationId, name, values, query },
  })
  if (result.kind === 'redirect') redirect(result.url)

  const validName = simLinkNameSchema.safeParse(name).success
  const creatable = result.kind === 'not_found' && validName
  return (
    <LogoShell center theme='inherit'>
      <StatusPageContent
        title={validName ? `sim/${name}` : 'Sim link'}
        description={describeUnresolved(result, validName, name)}
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

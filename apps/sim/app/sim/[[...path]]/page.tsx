import { ChipLink, StatusPageContent } from '@sim/emcn'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { APP_ENTRY_PATH, organizationRoutes, simLinkPath } from '@/lib/navigation/paths'
import { resolveSimLinkOrganization } from '@/lib/sim-links/application/organization'
import {
  resolveSimLink,
  type SimLinkResolution,
  suggestSimLinks,
} from '@/lib/sim-links/application/use-cases'
import { parseTypedSimLink, simLinkNameSchema } from '@/lib/sim-links/validation'
import { buildAuthCrossLink } from '@/app/(auth)/auth-redirect'
import { LogoShell } from '@/app/(landing)/components/logo-shell'
import { serializeSimLinkView } from '@/app/o/[organizationId]/links/search-params'

export const metadata: Metadata = {
  title: 'Link',
  robots: { index: false, follow: false },
}

interface SimLinkPageProps {
  params: Promise<{ path?: string[] }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
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
 * The query, from the params Next has already parsed and normalized (it re-serializes every
 * request's query before app code sees it, so the typed spelling isn't recoverable here).
 */
function toQueryString(searchParams: Record<string, string | string[] | undefined>): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(searchParams)) {
    for (const item of [value ?? []].flat()) query.append(key, item)
  }
  return query.toString()
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
  if (result.kind === 'invalid_values') return "Links can't open . or .. as a value."
  return validName ? "This link doesn't exist yet." : "That isn't a valid link name."
}

/**
 * Where `sim/<name>/<values…>?<query>` lands: the viewer's organization link's destination,
 * or a page that offers to create the link when nobody has yet.
 */
export default async function SimLinkPage({ params, searchParams }: SimLinkPageProps) {
  const [{ path = [] }, query] = await Promise.all([params, searchParams.then(toQueryString)])
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
  if (!organizationId) {
    return (
      <LogoShell center theme='inherit'>
        <StatusPageContent title='Links' description="Links aren't available for your account.">
          <ChipLink href={APP_ENTRY_PATH}>Open Sim</ChipLink>
        </StatusPageContent>
      </LogoShell>
    )
  }
  const library = organizationRoutes(organizationId).simLinks
  const { name, values } = parseTypedSimLink(segments)
  if (!name) redirect(library)

  const result = await resolveSimLink.execute({
    principal,
    input: { organizationId, name, values, query },
  })
  if (result.kind === 'redirect') redirect(result.url)

  const validName = simLinkNameSchema.safeParse(name).success
  // A name can't hold a space, so `sim card prices` is someone looking for a link, not naming one.
  if (result.kind === 'not_found' && /\s/.test(name)) {
    redirect(serializeSimLinkView(library, { search: name }))
  }
  const creatable = result.kind === 'not_found' && validName
  const similar = creatable
    ? await suggestSimLinks
        .execute({ principal, input: { query: name } })
        .then(({ links }) => links.slice(0, 3))
        // Similar names are a courtesy: failing to find them must not take down this page.
        .catch(() => [])
    : []
  return (
    <LogoShell center theme='inherit'>
      <StatusPageContent
        title={validName ? name : 'Link'}
        description={describeUnresolved(result, validName, name)}
      >
        {creatable && (
          <ChipLink variant='primary' href={serializeSimLinkView(library, { create: name })}>
            Create link
          </ChipLink>
        )}
        {similar.map((link) => (
          <ChipLink key={link.name} href={simLinkPath(link.name)}>
            {link.name}
          </ChipLink>
        ))}
        <ChipLink href={library}>All links</ChipLink>
      </StatusPageContent>
    </LogoShell>
  )
}

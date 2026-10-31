import {
  isVariableSimLinkUrl,
  parseHttpUrl,
  SIM_LINK_VARIABLE,
  simLinkOrigin,
} from '@/lib/sim-links/validation'

interface SimLinkDestination {
  url: string
  defaultUrl: string | null
}

export type SimLinkTarget =
  | { kind: 'redirect'; url: string }
  | { kind: 'missing_values'; required: number }
  | { kind: 'invalid_values' }

/**
 * A typed query rebuilt from parsed parameters with its spelling kept: values percent-encoded as
 * a URL path would be (a space stays `%20`, not `+`), and a key typed without a value stays bare
 * (`?edit`, not `?edit=`). Parameters with the same key come out together, after the first one.
 */
export function typedQueryString(
  params: Readonly<Record<string, string | readonly string[] | undefined>>
): string {
  return Object.entries(params)
    .flatMap(([key, value]) =>
      [value ?? []]
        .flat()
        .map((item) =>
          item ? `${encodeURIComponent(key)}=${encodeURIComponent(item)}` : encodeURIComponent(key)
        )
    )
    .join('&')
}

/** URL parsers resolve `.` and `..` even when encoded, so a value could climb out of the link's path. */
function isDotSegment(value: string): boolean {
  return value === '.' || value === '..'
}

function encodeSegments(values: readonly string[]): string {
  return values.map(encodeURIComponent).join('/')
}

/**
 * Values fill only what follows a closed authority, so leaving `origin` is a broken invariant.
 * The typed query follows the destination's own parameters, both kept as spelled; the `search`
 * setter percent-encodes anything a query can't hold, so a `#` in it can't start a fragment.
 */
function redirectWithin(origin: string, url: string, query: string): SimLinkTarget {
  const parsed = parseHttpUrl(url)
  if (parsed?.origin !== origin) throw new Error('Sim link resolved outside its fixed origin')
  if (query) parsed.search = parsed.search ? `${parsed.search}&${query}` : query
  return { kind: 'redirect', url: parsed.toString() }
}

/**
 * Where `sim/<name>/<values…>?<query>` leads. A plain link appends the values to its path.
 * A variable link fills each `{*}` in order, the last taking every remaining value,
 * and opens its default destination when given none. The query carries over to whichever
 * destination opens, and every redirect stays on the stored destination's origin.
 */
export function resolveSimLinkTarget(
  link: SimLinkDestination,
  values: readonly string[],
  query = ''
): SimLinkTarget {
  const origin = simLinkOrigin(link.url)
  if (!origin) throw new Error('Sim link destination has no fixed http(s) origin')
  if (values.some(isDotSegment)) return { kind: 'invalid_values' }
  if (!isVariableSimLinkUrl(link.url)) {
    if (!values.length) return redirectWithin(origin, link.url, query)
    const url = new URL(link.url)
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/${encodeSegments(values)}`
    return redirectWithin(origin, url.toString(), query)
  }
  if (!values.length && link.defaultUrl) return redirectWithin(origin, link.defaultUrl, query)
  const parts = link.url.split(SIM_LINK_VARIABLE)
  const slots = parts.length - 1
  if (values.length < slots) return { kind: 'missing_values', required: slots }
  const fills = [
    ...values.slice(0, slots - 1).map(encodeURIComponent),
    encodeSegments(values.slice(slots - 1)),
  ]
  return redirectWithin(
    origin,
    parts.reduce((url, part, index) => url + fills[index - 1] + part),
    query
  )
}

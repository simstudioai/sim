import { isVariableSimLinkUrl, parseHttpUrl, SIM_LINK_VARIABLE } from '@/lib/sim-links/validation'

interface SimLinkDestination {
  url: string
  defaultUrl: string | null
}

export type SimLinkTarget =
  | { kind: 'redirect'; url: string }
  | { kind: 'missing_values'; required: number }

function encodeSegments(values: readonly string[]): string {
  return values.map(encodeURIComponent).join('/')
}

function redirectTo(url: string): SimLinkTarget {
  const parsed = parseHttpUrl(url)
  if (!parsed) throw new Error('Sim link destination is not an http(s) URL')
  return { kind: 'redirect', url: parsed.toString() }
}

/**
 * Where `sim/<name>/<values…>` leads. A plain link appends the values to its path.
 * A variable link fills each `{*}` in order, the last taking every remaining value,
 * and opens its default destination when given none.
 */
export function resolveSimLinkTarget(
  link: SimLinkDestination,
  values: readonly string[]
): SimLinkTarget {
  if (!isVariableSimLinkUrl(link.url)) {
    if (!values.length) return redirectTo(link.url)
    const url = new URL(link.url)
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/${encodeSegments(values)}`
    return redirectTo(url.toString())
  }
  const parts = link.url.split(SIM_LINK_VARIABLE)
  const slots = parts.length - 1
  if (!values.length && link.defaultUrl) return redirectTo(link.defaultUrl)
  if (values.length < slots) return { kind: 'missing_values', required: slots }
  const fills = [
    ...values.slice(0, slots - 1).map(encodeURIComponent),
    encodeSegments(values.slice(slots - 1)),
  ]
  return redirectTo(parts.reduce((url, part, index) => url + fills[index - 1] + part))
}

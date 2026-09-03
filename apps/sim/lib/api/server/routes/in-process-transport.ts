import { NextRequest } from 'next/server'
import { markInternalRequest } from '@/lib/api/server/routes/internal-request'
import { V2_ROUTES } from '@/lib/api/server/routes/v2-route-table.generated'

/**
 * A `fetch` that answers the server's own v2 requests in-process.
 *
 * The embedded CLI and the agent-cli engines are typed v2 clients. Pointing them at
 * the server's URL made every tool call a network round trip through the proxy,
 * API-key authentication, the abuse rate limits, and the proxy body ceiling — a
 * grep over one block definition cost seconds and tripped the per-key limit. This
 * transport resolves the request's path against the generated route table and
 * invokes the route handler directly, with the request marked internal so
 * admission authenticates it but does not rate-limit it. Contracts, use cases,
 * presenters, and error envelopes are untouched: the handler that runs is the one
 * the network path would run.
 *
 * Anything outside the v2 table falls through to real `fetch`.
 */

type RouteHandler = (
  request: NextRequest,
  context: { params: Promise<Record<string, string>> }
) => Promise<Response>

interface CompiledRoute {
  regex: RegExp
  params: string[]
  /** Literal segments — a more specific pattern wins over a parameterized one. */
  literals: number
  load: () => Promise<object>
}

interface MatchedRoute {
  params: Record<string, string>
  literals: number
  load: () => Promise<object>
}

const COMPILED: CompiledRoute[] = V2_ROUTES.map((route) => {
  const params: string[] = []
  let literals = 0
  const source = route.pattern
    .split('/')
    .map((segment) => {
      const param = /^\{(.+)\}$/.exec(segment)
      if (!param?.[1]) {
        literals += 1
        return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      }
      params.push(param[1])
      return '([^/]+)'
    })
    .join('/')
  return { regex: new RegExp(`^${source}$`), params, literals, load: route.load }
})

export function matchV2Route(pathname: string): MatchedRoute | null {
  let best: MatchedRoute | null = null
  for (const route of COMPILED) {
    const match = route.regex.exec(pathname)
    if (!match) continue
    if (best && best.literals >= route.literals) continue
    const params: Record<string, string> = {}
    route.params.forEach((name, index) => {
      params[name] = decodeURIComponent(match[index + 1] ?? '')
    })
    best = { params, literals: route.literals, load: route.load }
  }
  return best
}

function requestUrl(input: RequestInfo | URL): URL {
  if (typeof input === 'string') return new URL(input)
  if (input instanceof URL) return input
  return new URL(input.url)
}

export function createInProcessTransport(): typeof fetch {
  return async (input, init) => {
    const url = requestUrl(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    const matched = url.pathname.startsWith('/api/v2/') ? matchV2Route(url.pathname) : null
    if (!matched) return fetch(input, init)
    const handler = Reflect.get(await matched.load(), method)
    if (typeof handler !== 'function') return fetch(input, init)
    const request = new NextRequest(url, {
      method,
      headers: init?.headers,
      body: init?.body ?? null,
      signal: init?.signal ?? undefined,
    })
    markInternalRequest(request)
    return (handler as RouteHandler)(request, { params: Promise.resolve(matched.params) })
  }
}

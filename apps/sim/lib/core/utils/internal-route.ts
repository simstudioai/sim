type QueryValue = string | number | boolean | null | undefined

/**
 * A route on Sim's own API, tagged so the transport can recognize it by identity.
 *
 * The transport resolves an internal route against the internal base URL and signs it with an
 * internal token for the executing user, so the decision to route internally must come from a
 * tool's source and never from its params. A branded value carries that provenance: params arrive
 * as strings and JSON and can never construct one, whereas a `/api/...` string a builder returns
 * is indistinguishable from one a caller supplied.
 */
export class InternalRoute {
  constructor(
    private readonly pathname: string,
    private readonly query: URLSearchParams = new URLSearchParams()
  ) {}

  /** Adds query params to the route, ignoring `undefined` and `null` values. */
  withQuery(query: URLSearchParams | Record<string, QueryValue>): InternalRoute {
    const next = new URLSearchParams(this.query)
    const entries = query instanceof URLSearchParams ? [...query] : Object.entries(query)
    for (const [key, value] of entries) {
      if (value !== undefined && value !== null) next.set(key, String(value))
    }
    return new InternalRoute(this.pathname, next)
  }

  /** The relative request path, including any query string. */
  get path(): string {
    const search = this.query.toString()
    return search ? `${this.pathname}?${search}` : this.pathname
  }
}

/**
 * Declares a route on Sim's own API, as a tagged template:
 *
 * ```ts
 * url: (params) => internalRoute`/api/table/${params.tableId}/rows`.withQuery({ limit: params.limit })
 * ```
 *
 * The literal segments are fixed at author time and every interpolated value is percent-encoded,
 * so a param can fill a path segment but can never widen the path into a different route. Query
 * params go through {@link InternalRoute.withQuery} rather than the template, so they are encoded
 * as values instead of being spliced into the path.
 *
 * @throws when the resolved path is not a relative `/api/` path.
 */
export function internalRoute(segments: TemplateStringsArray, ...values: unknown[]): InternalRoute {
  let pathname = segments[0]
  for (const [index, value] of values.entries()) {
    pathname += encodeURIComponent(String(value)) + segments[index + 1]
  }

  if (!pathname.startsWith('/api/')) {
    throw new Error(`Internal route must start with /api/: ${pathname}`)
  }
  if (pathname.includes('?')) {
    throw new Error(`Internal route query params belong in withQuery(): ${pathname}`)
  }

  return new InternalRoute(pathname)
}

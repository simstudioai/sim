/** Methods the fetch standard uppercases whatever their case; any other is sent as written. */
const FETCH_NORMALIZED_METHODS: ReadonlySet<string> = new Set([
  'DELETE',
  'GET',
  'HEAD',
  'OPTIONS',
  'POST',
  'PUT',
])

/** Methods that ask for data rather than change it. */
const READ_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS'])

/** Headers some servers honor to run a different method than the one sent. */
const METHOD_OVERRIDE_HEADERS: ReadonlySet<string> = new Set([
  'x-http-method-override',
  'x-http-method',
  'x-method-override',
])

/**
 * A method as `fetch` sends it: DELETE, GET, HEAD, OPTIONS, POST and PUT uppercased in any case,
 * any other method unchanged.
 */
export function normalizeFetchMethod(method: string): string {
  const upper = method.toUpperCase()
  return FETCH_NORMALIZED_METHODS.has(upper) ? upper : method
}

/**
 * Whether a request only reads: a GET, HEAD or OPTIONS (as {@link normalizeFetchMethod} sends it)
 * that carries no method-override header. An API that changes state on a GET still counts as a
 * read; nothing in the request can tell.
 */
export function isReadRequest(method: string, headerNames: Iterable<string>): boolean {
  if (!READ_METHODS.has(normalizeFetchMethod(method))) return false
  for (const name of headerNames) {
    if (METHOD_OVERRIDE_HEADERS.has(name.toLowerCase())) return false
  }
  return true
}

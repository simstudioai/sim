/**
 * A JSON `Response` with `Content-Type: application/json`, for stubbing
 * `fetch` results and upstream API replies.
 *
 * @param body - Serialized with `JSON.stringify`.
 * @param init - A status code, or a full `ResponseInit` whose headers are
 *   merged over the JSON content type. Defaults to `200`.
 *
 * @example
 * ```ts
 * fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'user-1' }))
 * fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'nope' }, 403))
 * ```
 */
export function jsonResponse(body: unknown, init: number | ResponseInit = 200): Response {
  const { headers, ...rest } = typeof init === 'number' ? { status: init } : init
  const merged = new Headers(headers)
  if (!merged.has('Content-Type')) merged.set('Content-Type', 'application/json')
  return new Response(JSON.stringify(body), { ...rest, headers: merged })
}

/**
 * The second argument a Next.js dynamic route handler receives.
 *
 * @example
 * ```ts
 * const res = await GET(createMockRequest('GET'), createRouteContext({ id: 'wf-1' }))
 * ```
 */
export function createRouteContext<P extends Record<string, string | string[]>>(
  params: P
): { params: Promise<P> } {
  return { params: Promise.resolve(params) }
}

/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { DELETE, GET, PATCH, POST, PUT } from '@/app/api/v2/[[...segments]]/route'

/**
 * An unknown path under `/api/v2` used to fall through to the app's global
 * `not-found` page, so a mistyped URL handed an API client a full HTML document
 * — the one v2 response a JSON-parsing caller cannot read.
 *
 * The body must stay byte-identical to the rollout gate's 404
 * (`v2ApiGateError`), which answers 404 so an ungated caller cannot tell "not in
 * the cohort" from "no such endpoint". A different body here would give that
 * distinction straight back.
 */
describe('unknown /api/v2 path', () => {
  const EXPECTED = { error: { code: 'NOT_FOUND', message: 'Not found' } }

  function probe(method: string) {
    return new NextRequest('http://localhost/api/v2/nonexistent', { method })
  }

  it('answers JSON, not an HTML document', async () => {
    const response = await GET(probe('GET'), undefined)

    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(await response.json()).toEqual(EXPECTED)
  })

  it.each([
    ['POST', POST],
    ['PUT', PUT],
    ['PATCH', PATCH],
    ['DELETE', DELETE],
  ])('answers the same envelope for %s', async (method, handler) => {
    const response = await handler(probe(method), undefined)

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual(EXPECTED)
  })

  it('does not require an API key, so probing a typo cannot become a 401', async () => {
    const response = await GET(probe('GET'), undefined)

    expect(response.status).toBe(404)
  })
})

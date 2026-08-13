/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { v2InvalidJsonResponse } from '@/lib/api/server/routes/v2-json-route'

/**
 * v2 promises exactly one failure shape — `{ error: { code, message } }` — and a
 * client written against it reads `error.code`. That promise held for validation
 * errors and broke for transport-level ones: a malformed or absent JSON body
 * fell through to `parseRequest`'s framework default, a bare
 * `{ "error": "Request body must be valid JSON" }` string, so `error.code` was
 * `undefined` exactly when the request was malformed.
 *
 * The fix made the envelope a builder default rather than a per-route opt-in
 * that only 8 of 77 routes remembered, so this asserts the default itself.
 */
describe('v2 malformed-body envelope', () => {
  it('renders the canonical error envelope, not a bare string', async () => {
    const response = v2InvalidJsonResponse()

    expect(response.status).toBe(400)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(await response.json()).toEqual({
      error: { code: 'BAD_REQUEST', message: 'Request body must be valid JSON' },
    })
  })

  it('keeps the body out of shared caches like every other v2 response', () => {
    expect(v2InvalidJsonResponse().headers.get('Cache-Control')).toBe('private, no-store')
  })

  it('exposes a machine-readable code, which the bare-string form could not', async () => {
    const body = (await v2InvalidJsonResponse().json()) as { error: { code?: string } }
    expect(typeof body.error).toBe('object')
    expect(body.error.code).toBe('BAD_REQUEST')
  })
})

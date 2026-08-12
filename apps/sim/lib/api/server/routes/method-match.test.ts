/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { methodMatchesContract } from '@/lib/api/server/routes/definition'

/**
 * Every v2 route builder guards that the request's method is the one its
 * contract declares, which is how a handler exported under the wrong verb fails
 * loudly instead of serving the wrong contract.
 *
 * That guard rejected `HEAD` outright, and Next answers a `HEAD` by invoking the
 * route's own `GET` export (`auto-implement-methods.ts` sets
 * `methods.HEAD = handlers.GET`), so the guard threw and every v2 read replied
 * **500** to a plain `HEAD` — the request health checkers, uptime monitors, link
 * checkers, and some CDNs send, all of which read the API as hard-down.
 *
 * RFC 9110 §9.3.2 makes HEAD identical to GET but for the body, and Next already
 * drops the body when sending (`send-response.ts` skips the stream when
 * `req.method === 'HEAD'`), so running the GET path is exactly right.
 */
describe('methodMatchesContract', () => {
  it('accepts HEAD against a GET contract', () => {
    expect(methodMatchesContract('HEAD', 'GET')).toBe(true)
  })

  it.each(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])('accepts %s against its own contract', (m) => {
    expect(methodMatchesContract(m, m)).toBe(true)
  })

  /**
   * HEAD is only ever aliased onto GET. A body-bearing contract answering a
   * bodyless request would be a wiring mistake, not framework behaviour.
   */
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('rejects HEAD against a %s contract', (m) => {
    expect(methodMatchesContract('HEAD', m)).toBe(false)
  })

  it('still rejects a handler exported under the wrong verb', () => {
    expect(methodMatchesContract('POST', 'GET')).toBe(false)
    expect(methodMatchesContract('GET', 'DELETE')).toBe(false)
    expect(methodMatchesContract('PATCH', 'PUT')).toBe(false)
  })

  it('does not treat GET as satisfying a HEAD contract', () => {
    expect(methodMatchesContract('GET', 'HEAD')).toBe(false)
  })
})

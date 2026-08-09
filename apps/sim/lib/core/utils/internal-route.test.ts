/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { InternalRoute, internalRoute } from '@/lib/core/utils/internal-route'

describe('internalRoute', () => {
  it('builds a route from its literal segments', () => {
    expect(internalRoute`/api/table/${'t-1'}/rows`.path).toBe('/api/table/t-1/rows')
  })

  it('encodes an interpolated value so it cannot widen the path', () => {
    expect(internalRoute`/api/table/${'../../admin'}/rows`.path).toBe(
      '/api/table/..%2F..%2Fadmin/rows'
    )
  })

  it('encodes a query-shaped value instead of letting it add params', () => {
    expect(internalRoute`/api/table/${'t-1?workspaceId=other'}`.path).toBe(
      '/api/table/t-1%3FworkspaceId%3Dother'
    )
  })

  it('rejects a route outside /api/', () => {
    expect(() => internalRoute`/health`).toThrow(/must start with \/api\//)
  })

  it('rejects an interpolated absolute URL', () => {
    expect(() => internalRoute`${'https://attacker.example/api/x'}`).toThrow(
      /must start with \/api\//
    )
  })

  it('rejects a query string in the template', () => {
    expect(() => internalRoute`/api/logs?limit=1`).toThrow(/belong in withQuery/)
  })

  describe('withQuery', () => {
    it('appends and encodes params', () => {
      const route = internalRoute`/api/logs`.withQuery({ search: 'a b&c', limit: 10 })

      expect(route.path).toBe('/api/logs?search=a+b%26c&limit=10')
    })

    it('accepts URLSearchParams', () => {
      const route = internalRoute`/api/logs`.withQuery(new URLSearchParams({ level: 'error' }))

      expect(route.path).toBe('/api/logs?level=error')
    })

    it('skips undefined and null values', () => {
      const route = internalRoute`/api/logs`.withQuery({ a: undefined, b: null, c: 'keep' })

      expect(route.path).toBe('/api/logs?c=keep')
    })

    it('does not mutate the route it was called on', () => {
      const base = internalRoute`/api/logs`
      base.withQuery({ a: '1' })

      expect(base.path).toBe('/api/logs')
    })
  })

  it('cannot be constructed from data a param can carry', () => {
    const fromParams: unknown = structuredClone({ path: '/api/admin', pathname: '/api/admin' })

    expect(fromParams).not.toBeInstanceOf(InternalRoute)
  })
})

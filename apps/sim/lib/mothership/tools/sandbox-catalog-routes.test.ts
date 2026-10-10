import { describe, expect, it } from 'vitest'
import { matchV2Route } from '@/lib/api/server/routes/in-process-transport'
import { isCatalogRoute } from '@/lib/mothership/tools/sandbox-catalog-routes'

function routePattern(path: string): string {
  const matched = matchV2Route(path)
  if (!matched) throw new Error(`No v2 route matches ${path}`)
  return matched.pattern
}

describe('isCatalogRoute', () => {
  it.each([
    '/api/v2/blocks',
    '/api/v2/blocks/slack',
    '/api/v2/tools',
    '/api/v2/tools/slack_message',
    '/api/v2/connector-types',
  ])('classifies GET %s, as the route table resolves it, as catalog', (path) => {
    expect(isCatalogRoute('GET', routePattern(path))).toBe(true)
  })

  it('does not classify data-bearing or mutating routes as catalog', () => {
    expect(isCatalogRoute('GET', routePattern('/api/v2/logs/run-1'))).toBe(false)
    expect(isCatalogRoute('POST', routePattern('/api/v2/tools/slack_message/execute'))).toBe(false)
    expect(isCatalogRoute('POST', routePattern('/api/v2/tools'))).toBe(false)
  })
})

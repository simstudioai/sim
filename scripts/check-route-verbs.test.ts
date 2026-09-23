import { describe, expect, it } from 'vitest'
import { wrappedRouteSites } from './check-route-verbs'

describe('traced route declarations', () => {
  const handler = `const handler = defineInternalJsonRoute({
  contract: abortContract,
})`
  it('resolves the actual exported verb through a tracing callback', () => {
    const source = `${handler}
export const POST = (request: NextRequest, context?: Parameters<typeof handler>[1]) =>
  withIncomingGoSpan(request.headers, span, undefined, () => handler(request, context))`
    expect(wrappedRouteSites(source)).toEqual([
      { verb: 'POST', optionsStart: source.indexOf('{') + 1 },
    ])
  })
  it('does not silently accept an unused builder or a similarly named function', () => {
    expect(wrappedRouteSites(`${handler}\nexport const POST = () => otherHandler()`)).toEqual([])
  })
  it('preserves a wrong verb so the contract comparison rejects it', () => {
    expect(wrappedRouteSites(`${handler}\nexport const GET = (r) => handler(r)`)[0]?.verb).toBe(
      'GET'
    )
  })
  it('checks both handlers selected by a backend feature flag', () => {
    const source = `${handler}
const fallback = defineInternalJsonRoute({
  contract: fallbackContract,
})
export const POST = enabled ? handler : fallback`
    expect(wrappedRouteSites(source)).toEqual([
      { verb: 'POST', optionsStart: source.indexOf('{') + 1 },
      { verb: 'POST', optionsStart: source.indexOf('{', source.indexOf('const fallback')) + 1 },
    ])
  })
  it('checks an exported local handler alias', () => {
    expect(wrappedRouteSites(`${handler}\nexport const POST = handler`)).toEqual([
      { verb: 'POST', optionsStart: handler.indexOf('{') + 1 },
    ])
  })
})

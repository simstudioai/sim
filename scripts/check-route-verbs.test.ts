import { describe, expect, it } from 'vitest'
import { rawRouteContractSites, wrappedRouteSites } from './check-route-verbs'

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
})

describe('raw route parseRequest sites', () => {
  it('attributes a contract parsed in a same-file helper to the verb that calls it', () => {
    const source = `async function handle(request) {
  return parseRequest(updateContract, request, {})
}
export const PATCH = withRouteHandler((request) => handle(request))`
    expect(rawRouteContractSites(source)).toEqual([{ verb: 'PATCH', identifier: 'updateContract' }])
  })
  it('checks a verb alias only under the verb it forwards to', () => {
    const source = `export const PATCH = withRouteHandler((request) => parseRequest(updateContract, request, {}))
export const PUT = withRouteHandler((request, context) => PATCH(request, context))`
    expect(rawRouteContractSites(source)).toEqual([{ verb: 'PATCH', identifier: 'updateContract' }])
  })
})

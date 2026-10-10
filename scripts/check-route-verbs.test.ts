import { describe, expect, it } from 'vitest'
import {
  checkSite,
  importedNames,
  rawRouteContractSites,
  wrappedRouteSites,
} from './check-route-verbs'

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
  it('checks a builder handler exported through an export list', () => {
    const source = `const GET = defineInternalJsonRoute({
  contract: abortContract,
})
export { GET }`
    expect(wrappedRouteSites(source)).toEqual([
      { verb: 'GET', optionsStart: source.indexOf('{') + 1 },
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

describe('export-list verbs on raw routes', () => {
  it('checks a handler exported as \`export { GET }\`', () => {
    const source = `const GET = withRouteHandler((request) => parseRequest(listContract, request, {}))
export { GET }`
    expect(rawRouteContractSites(source)).toEqual([{ verb: 'GET', identifier: 'listContract' }])
  })
  it('attributes a renamed export to its exported verb, so a wrong verb is compared', () => {
    const source = `const handler = withRouteHandler((request) => parseRequest(updateContract, request, {}))
export { handler as PUT }`
    expect(rawRouteContractSites(source)).toEqual([{ verb: 'PUT', identifier: 'updateContract' }])
  })
})

describe('aliased contract imports', () => {
  const source = `import { updateContract as contract } from '@/lib/api/contracts/things'`
  const route = {
    relative: 'route.ts',
    bindings: importedNames(source),
    expectedPath: '/api/things',
  }
  const loadModule = () =>
    Promise.resolve({ updateContract: { method: 'PATCH', path: '/api/things' } })

  it('reads the contract by its exported name and passes the matching verb', async () => {
    const failures: string[] = []
    expect(await checkSite(route, 'raw', 'PATCH', 'contract', failures, false, loadModule)).toBe(
      true
    )
    expect(failures).toEqual([])
  })
  it('reports a verb that disagrees with the aliased contract', async () => {
    const failures: string[] = []
    await checkSite(route, 'builder', 'PUT', 'contract', failures, false, loadModule)
    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain('which declares PATCH /api/things')
  })
})

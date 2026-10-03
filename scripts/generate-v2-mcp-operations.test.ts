import { describe, expect, it } from 'vitest'
import type { Operation } from './generate-v2-cli-api'
import { classifyOperation } from './generate-v2-mcp-operations'

function operation(method: string, path: string, mode = 'json'): Operation {
  return {
    name: 'op',
    exportName: 'v2OpContract',
    domain: 'tables',
    contract: { method, path, response: { mode } },
  }
}

const routeSource = (method: string, builder: string) =>
  `export const dynamic = 'force-dynamic'\nexport const ${method} = ${builder}({\n  contract,\n})\n`

describe('the Sim MCP operation table', () => {
  it.each([
    ['defineV2JsonRoute', 'json'],
    ['defineV2BinaryRoute', 'excluded'],
    ['defineV2BodyLifecycleRoute', 'excluded'],
  ])('classifies %s routes as %s', (builder, expected) => {
    expect(
      classifyOperation(operation('POST', '/api/v2/tables'), () => routeSource('POST', builder))
    ).toBe(expected)
  })

  it('accepts a raw route only once it has been reviewed', () => {
    const raw = () => routeSource('POST', 'withRouteHandler')
    expect(classifyOperation({ ...operation('POST', '/api/v2/chat'), name: 'chat' }, raw)).toBe(
      'json'
    )
    expect(() => classifyOperation(operation('POST', '/api/v2/tables'), raw)).toThrow('classify it')
  })

  it('refuses to guess about a missing module or an unknown builder', () => {
    expect(() => classifyOperation(operation('GET', '/api/v2/tables'), () => null)).toThrow(
      'no route module'
    )
    expect(() =>
      classifyOperation(operation('GET', '/api/v2/tables'), () =>
        routeSource('GET', 'defineV3Route')
      )
    ).toThrow('classify it')
  })
})

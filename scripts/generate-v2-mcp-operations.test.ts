import { describe, expect, it } from 'vitest'
import type { Operation } from './generate-v2-cli-api'
import {
  classifyOperation,
  render,
  routeBuilder,
  routeModulePath,
} from './generate-v2-mcp-operations'

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
  it('finds a route module by its contract path', () => {
    expect(routeModulePath('/api/v2/tables/[tableId]/rows')).toBe(
      'app/api/v2/tables/[tableId]/rows/route.ts'
    )
  })

  it('reads the builder behind one method, not its neighbours', () => {
    const source = `${routeSource('GET', 'defineV2BinaryRoute')}${routeSource('PATCH', 'defineV2JsonRoute')}`
    expect(routeBuilder(source, 'GET')).toBe('defineV2BinaryRoute')
    expect(routeBuilder(source, 'PATCH')).toBe('defineV2JsonRoute')
    expect(routeBuilder(source, 'DELETE')).toBeNull()
  })

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

  it('excludes binary responses without reading the route', () => {
    expect(
      classifyOperation(operation('GET', '/api/v2/files/[fileId]', 'binary'), () => {
        throw new Error('should not read')
      })
    ).toBe('excluded')
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

  it('pairs each contract with a lazily imported handler', () => {
    const source = render([
      {
        name: 'listTables',
        exportName: 'v2ListTablesContract',
        domain: 'tables',
        method: 'GET',
        modulePath: 'app/api/v2/tables/route.ts',
        doc: { summary: 'List Tables' },
      },
    ])
    expect(source).toContain("import { v2ListTablesContract } from '@/lib/api/contracts/v2/tables'")
    expect(source).toContain(
      "handler: () => import('@/app/api/v2/tables/route').then((route) => route.GET)"
    )
    expect(source).toContain('summary: "List Tables"')
  })
})

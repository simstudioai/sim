import { describe, expect, it } from 'vitest'
import { findViolations, type Rule } from './check-source-conventions'

function hits(file: string, source: string, rule: Rule) {
  return findViolations(file, source)
    .filter((violation) => violation.rule === rule)
    .map(({ detail }) => detail)
}

describe('relative-import', () => {
  const MODULE = 'apps/sim/lib/feature/service.ts'
  const BARREL = 'apps/sim/lib/feature/index.ts'

  it('flags every import form that names a relative path', () => {
    const source = [
      "import { a } from './a'",
      "import type { B } from '../b'",
      "import './side-effect'",
      "export { c } from './c'",
      "export * from '../d'",
      "const e = await import('./e')",
      "const f = require('../f')",
      "import g = require('./g')",
    ].join('\n')
    expect(hits(MODULE, source, 'relative-import')).toEqual([
      './a',
      '../b',
      './side-effect',
      './c',
      '../d',
      './e',
      '../f',
      './g',
    ])
  })

  it('lets a barrel re-export its own folder, by either spelling', () => {
    const source = [
      "export { a } from './a'",
      "export * from './nested/b'",
      "import { c } from './c'",
      'export { c }',
    ].join('\n')
    expect(hits(BARREL, source, 'relative-import')).toEqual([])
  })

  it('still flags a barrel reaching outside its folder', () => {
    expect(hits(BARREL, "export { a } from '../a'", 'relative-import')).toEqual(['../a'])
  })

  it('ignores a relative path that is only text', () => {
    const source = "const snippet = \"import { a } from './a'\"\nconst code = `from '../b'`"
    expect(hits(MODULE, source, 'relative-import')).toEqual([])
  })

  it('applies to tests too, and nowhere outside apps/sim', () => {
    expect(
      hits('apps/sim/lib/feature/service.test.ts', "import { a } from './a'", 'relative-import')
    ).toHaveLength(1)
    expect(
      hits('packages/utils/src/object.ts', "import { a } from './a'", 'relative-import')
    ).toEqual([])
  })
})

describe('text-size-literal', () => {
  const FILE = 'apps/sim/app/workspace/page.tsx'

  it('flags a size the text scale names, alone or behind variants and important', () => {
    const source = [
      "<p className='text-[13px] text-[var(--text-muted)]' />",
      "<p className='md:text-[14px] !text-[10px]' />",
      "cn('font-medium', 'text-[12px]')",
    ].join('\n')
    expect(hits(FILE, source, 'text-size-literal')).toEqual([
      'text-[13px] → text-small',
      'text-[14px] → text-sm',
      'text-[10px] → text-micro',
      'text-[12px] → text-caption',
    ])
  })

  it('skips sizes the scale has no token for, colors and variables', () => {
    const source =
      "<h1 className='text-[32px] text-[13.5px] text-[#fff] text-[var(--x)] max-text-[13px]' />"
    expect(hits(FILE, source, 'text-size-literal')).toEqual([])
  })
})

describe('static-inline-style', () => {
  const FILE = 'apps/sim/app/workspace/page.tsx'
  const jsx = (...elements: string[]) => `const view = (\n<>\n${elements.join('\n')}\n</>\n)`

  it('flags a style object whose every value is a static literal', () => {
    const source = jsx(
      "<div style={{ display: 'none' }} />",
      '<col style={{ width: 140, marginTop: -1 }} />',
      '<div style={{ position: `absolute` }} />'
    )
    expect(hits(FILE, source, 'static-inline-style')).toHaveLength(3)
  })

  it('allows dynamic values, CSS variables, custom properties, spreads and computed keys', () => {
    const source = jsx(
      '<div style={{ width }} />',
      '<div style={{ width: size, display: "flex" }} />',
      "<div style={{ width: 'var(--sidebar-width)' }} />",
      "<div style={{ '--cta-size': '12px' }} />",
      '<div style={{ ...base }} />',
      "<div style={{ [key]: 'red' }} />",
      `<div style={{ left: \`\${x}px\` }} />`,
      '<div style={STYLE} />'
    )
    expect(hits(FILE, source, 'static-inline-style')).toEqual([])
  })

  it('skips files rendered without the Tailwind stylesheet', () => {
    const email = "import { Text } from '@react-email/components'\n<Text style={{ margin: 0 }} />"
    const og = "import { ImageResponse } from 'next/og'\n<div style={{ display: 'flex' }} />"
    expect(hits('apps/sim/components/emails/a.tsx', email, 'static-inline-style')).toEqual([])
    expect(hits('apps/sim/app/opengraph-image.tsx', og, 'static-inline-style')).toEqual([])
  })
})

describe('api-db-import', () => {
  const ROUTE = 'apps/sim/app/api/things/route.ts'

  it('flags value imports, re-exports and dynamic imports of @sim/db and its subpaths', () => {
    const source = [
      "import { db } from '@sim/db'",
      "import { thing, type Thing } from '@sim/db/schema'",
      "export { db } from '@sim/db'",
      "const mod = await import('@sim/db/schema')",
    ].join('\n')
    expect(hits(ROUTE, source, 'api-db-import')).toEqual([
      '@sim/db',
      '@sim/db/schema',
      '@sim/db',
      '@sim/db/schema',
    ])
  })

  it('allows type-only imports', () => {
    const source = [
      "import type { Thing } from '@sim/db/schema'",
      "import { type Other } from '@sim/db/schema'",
      "export type { Thing } from '@sim/db/schema'",
      "export { type Other } from '@sim/db/schema'",
    ].join('\n')
    expect(hits(ROUTE, source, 'api-db-import')).toEqual([])
  })

  it('covers helpers beside a route, but not tests or code outside app/api', () => {
    const source = "import { db } from '@sim/db'"
    expect(hits('apps/sim/app/api/things/utils.ts', source, 'api-db-import')).toHaveLength(1)
    expect(hits('apps/sim/app/api/things/route.test.ts', source, 'api-db-import')).toEqual([])
    expect(hits('apps/sim/app/api/things/route.integration.ts', source, 'api-db-import')).toEqual(
      []
    )
    expect(hits('apps/sim/lib/things/service.ts', source, 'api-db-import')).toEqual([])
  })
})

describe('bare-route-handler', () => {
  const ROUTE = 'apps/sim/app/api/things/route.ts'

  it('flags a verb exported as its own handler body', () => {
    const source = [
      'export async function GET() { return new Response() }',
      'export function HEAD() { return new Response() }',
      'export const POST = async (request) => handle(request)',
      'export const PUT = (request) => { return handle(request) }',
      'export const PATCH = function (request) { return handle(request) }',
    ].join('\n')
    expect(hits(ROUTE, source, 'bare-route-handler')).toEqual([
      'GET',
      'HEAD',
      'POST',
      'PUT',
      'PATCH',
    ])
  })

  it('resolves a renamed local export', () => {
    const source = [
      'async function handler() { return new Response() }',
      'const wrapped = withRouteHandler(handler)',
      'export { handler as GET, wrapped as POST }',
    ].join('\n')
    expect(hits(ROUTE, source, 'bare-route-handler')).toEqual(['GET'])
  })

  it('allows builder results and one-call synchronous delegates', () => {
    const source = [
      'export const GET = withRouteHandler(async () => new Response())',
      'export const POST = defineInternalJsonRoute({ useCase })',
      'export const DELETE = (request, context) => withSpan(request, () => handler(request, context))',
      'export const dynamic = "force-dynamic"',
    ].join('\n')
    expect(hits(ROUTE, source, 'bare-route-handler')).toEqual([])
  })

  it('only checks route files', () => {
    expect(
      hits(
        'apps/sim/app/api/things/utils.ts',
        'export async function GET() {}',
        'bare-route-handler'
      )
    ).toEqual([])
  })
})

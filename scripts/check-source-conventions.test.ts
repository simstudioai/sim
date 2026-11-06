import { describe, expect, it } from 'vitest'
import {
  type Baseline,
  type CurrentCounts,
  compareToBaseline,
  findViolations,
  nextBaseline,
  type Rule,
} from './check-source-conventions'

function hits(file: string, source: string, rule: Rule) {
  return findViolations(file, source)
    .filter((violation) => violation.rule === rule)
    .map(({ detail }) => detail)
}

function lines(file: string, source: string, rule: Rule) {
  return findViolations(file, source)
    .filter((violation) => violation.rule === rule)
    .map(({ line }) => line)
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
      "const h = await import(/* webpackChunkName: 'h' */ './h')",
      "type I = import('./i').I",
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
      './h',
      './i',
    ])
  })

  it('lets a barrel pass its own folder through, by either spelling', () => {
    const source = [
      "export { a } from './a'",
      "export * from './nested/b'",
      "import { c } from './c'",
      "import d from './d'",
      "import { e } from './e'",
      'export { c, d as default }',
      'export const renamedE = e',
    ].join('\n')
    expect(hits(BARREL, source, 'relative-import')).toEqual([])
  })

  it('flags a barrel line that leaves the folder or is not a pass-through', () => {
    const source = [
      "export { a } from '../a'",
      "export { b } from './../b'",
      "import './side-effect'",
      "import { kept } from './kept'",
      "import { half, other } from './half'",
      'export const registry = { kept }',
      'export { half }',
      "const lazy = await import('./lazy')",
    ].join('\n')
    expect(hits(BARREL, source, 'relative-import')).toEqual([
      '../a',
      './../b',
      './side-effect',
      './kept',
      './half',
      './lazy',
    ])
  })

  it('finds a dynamic import whose only relative path follows a comment', () => {
    const source = "export const load = () => import(/* webpackChunkName: 'h' */ './h')"
    expect(hits(MODULE, source, 'relative-import')).toEqual(['./h'])
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

  it('exempts a Mothership contract copy only where contracts:sync writes it', () => {
    const copy = [
      '// GENERATED — do not edit. Source of truth: mothership worker packages/contracts/src/sim-transport.ts',
      "import { MemoryNotesAccessInput } from './memory-notes-access'",
    ].join('\n')
    expect(
      hits('apps/sim/lib/mothership/generated/sim-transport.ts', copy, 'relative-import')
    ).toEqual([])
    expect(hits('apps/sim/lib/feature/service.ts', copy, 'relative-import')).toEqual([
      './memory-notes-access',
    ])
    expect(
      hits(
        'apps/sim/lib/mothership/generated/handwritten.ts',
        "import { a } from './a'",
        'relative-import'
      )
    ).toEqual(['./a'])
  })
})

describe('text-size-literal', () => {
  const FILE = 'apps/sim/app/workspace/page.tsx'

  it('flags a size the text scale names, alone or behind variants and important', () => {
    const source = [
      "const a = <p className='text-[13px] text-[var(--text-muted)]' />",
      "const b = <p className='md:text-[14px] !text-[10px]' />",
      "const c = cn('font-medium', 'text-[12px]')",
      "const d = cn('text-[13.0px]')",
    ].join('\n')
    expect(hits(FILE, source, 'text-size-literal')).toEqual([
      'text-[13px] → text-small',
      'text-[14px] → text-sm',
      'text-[10px] → text-micro',
      'text-[12px] → text-caption',
      'text-[13.0px] → text-small',
    ])
  })

  it('reports the line inside a multi-line template literal', () => {
    const source = ['const classes = `', '  flex', '  text-[16px]', '`'].join('\n')
    expect(lines(FILE, source, 'text-size-literal')).toEqual([3])
  })

  it('skips sizes the scale has no token for, colors, variables and comments', () => {
    const source = [
      "const a = <h1 className='text-[32px] text-[13.5px] text-[#fff] text-[var(--x)] max-text-[13px]' />",
      '// Replace text-[13px] with text-small',
      '/* text-[14px] */',
    ].join('\n')
    expect(hits(FILE, source, 'text-size-literal')).toEqual([])
  })
})

describe('static-inline-style', () => {
  const FILE = 'apps/sim/app/workspace/page.tsx'
  const jsx = (...elements: string[]) => `const view = (\n<>\n${elements.join('\n')}\n</>\n)`

  it('flags a style object whose every value is a static literal, however it is spaced or cast', () => {
    const source = jsx(
      "<div style={{ display: 'none' }} />",
      '<col style={{ width: 140, marginTop: -1 }} />',
      '<div style={{ position: `absolute` }} />',
      "<div style={ { display: 'none' } } />",
      "<div style = {{ display: 'none' } as CSSProperties} />",
      "<div style={{ display: 'none' as const, opacity: 0 satisfies number }} />"
    )
    expect(hits(FILE, source, 'static-inline-style')).toHaveLength(6)
  })

  it('finds a static style whose braces are spaced apart', () => {
    expect(
      hits(FILE, jsx("<div style={ { display: 'none' } } />"), 'static-inline-style')
    ).toHaveLength(1)
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

  it('does not exempt a file that only mentions a renderer in a comment', () => {
    const source =
      "// rendered like `from 'next/og'`\nconst a = <div style={{ display: 'none' }} />"
    expect(hits(FILE, source, 'static-inline-style')).toHaveLength(1)
  })

  it('skips files rendered without the Tailwind stylesheet', () => {
    const email =
      "import { Text } from '@react-email/components'\nconst a = <Text style={{ margin: 0 }} />"
    const og =
      "import { ImageResponse } from 'next/og'\nconst a = <div style={{ display: 'flex' }} />"
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

  it('flags a verb exported as a handler body written in the route', () => {
    const source = [
      'export async function GET() { return new Response() }',
      'export function HEAD() { return new Response() }',
      'export const POST = async (request) => handle(request)',
      'export const PUT = (request) => { return handle(request) }',
      'export const PATCH = function (request) { return handle(request) }',
      'export const DELETE = () => new Response()',
      'export const OPTIONS = (request) => respond(request)',
    ].join('\n')
    expect(hits(ROUTE, source, 'bare-route-handler')).toEqual([
      'GET',
      'HEAD',
      'POST',
      'PUT',
      'PATCH',
      'DELETE',
      'OPTIONS',
    ])
  })

  it('follows local aliases and renamed exports to the function behind them', () => {
    const source = [
      'async function handler() { return new Response() }',
      'const alias = handler',
      'const loop = () => other()',
      'const other = () => loop()',
      'const wrapped = withRouteHandler(handler)',
      'const routes = { PATCH: async () => new Response(), HEAD() { return new Response() } }',
      'export const GET = alias',
      'export const PUT = loop',
      'export const PATCH = routes.PATCH',
      'export const HEAD = routes.HEAD',
      'export { handler as POST, wrapped as DELETE }',
    ].join('\n')
    expect(hits(ROUTE, source, 'bare-route-handler')).toEqual([
      'GET',
      'PUT',
      'PATCH',
      'HEAD',
      'POST',
    ])
  })

  it('reads a local object member as the entry that wins at runtime', () => {
    const source = [
      'const handler = defineInternalJsonRoute({ useCase })',
      'const spread = { GET: handler, ...overrides }',
      'const computed = { POST: handler, [verb]: async () => new Response() }',
      'const repeated = { PUT: handler, PUT: async () => new Response() }',
      'const restored = { ...overrides, DELETE: handler }',
      'export const GET = spread.GET',
      'export const POST = computed.POST',
      'export const PUT = repeated.PUT',
      'export const DELETE = restored.DELETE',
    ].join('\n')
    expect(hits(ROUTE, source, 'bare-route-handler')).toEqual(['GET', 'POST', 'PUT'])
  })

  it('allows wrapped results, their aliases and members, imports, and delegates to them', () => {
    const source = [
      "import { sharedHandler } from '@/lib/things/route'",
      'const handler = defineInternalJsonRoute({ useCase })',
      'const handlers = createMcpHandlers()',
      'export const GET = withRouteHandler(async () => new Response())',
      'export const POST = handler',
      'export const PUT = handlers.PUT',
      'export const PATCH = sharedHandler',
      'export const DELETE = (request, context) => withSpan(request, () => handler(request, context))',
      'export const HEAD = (request) => (offHost(request) ? notFound() : handler(request))',
      'export const OPTIONS = flag ? handler : handlers.OPTIONS',
      'export const dynamic = "force-dynamic"',
    ].join('\n')
    const objectMembers = [
      'const handler = defineInternalJsonRoute({ useCase })',
      'const routes = { GET: withRouteHandler(async () => new Response()), PUT: handler }',
      'export const GET = routes.GET',
      'export const PUT = routes.PUT',
    ].join('\n')
    expect(hits(ROUTE, source, 'bare-route-handler')).toEqual([])
    expect(hits(ROUTE, objectMembers, 'bare-route-handler')).toEqual([])
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

describe('baseline ratchet', () => {
  const EMPTY: CurrentCounts = {
    'relative-import': {},
    'text-size-literal': {},
    'static-inline-style': {},
    'api-db-import': {},
    'bare-route-handler': {},
  }
  const counts = (partial: Partial<CurrentCounts>): CurrentCounts => ({ ...EMPTY, ...partial })
  const BASELINE: Baseline = { ...EMPTY, 'relative-import': { 'a.ts': 2, 'b.ts': 1 } }

  it('fails a file whose count rises, or that gains its first hit', () => {
    const current = counts({ 'relative-import': { 'a.ts': 3, 'b.ts': 1, 'c.ts': 1 } })
    expect(compareToBaseline(BASELINE, current).raised).toEqual([
      { rule: 'relative-import', file: 'a.ts', count: 3, allowed: 2 },
      { rule: 'relative-import', file: 'c.ts', count: 1, allowed: 0 },
    ])
  })

  it('fails a count that dropped, so the fix is locked in', () => {
    const current = counts({ 'relative-import': { 'a.ts': 1 } })
    expect(compareToBaseline(BASELINE, current)).toEqual({
      raised: [],
      dropped: [
        { rule: 'relative-import', file: 'a.ts', count: 1, allowed: 2 },
        { rule: 'relative-import', file: 'b.ts', count: 0, allowed: 1 },
      ],
    })
  })

  it('passes when counts match the baseline exactly', () => {
    const current = counts({ 'relative-import': { 'a.ts': 2, 'b.ts': 1 } })
    expect(compareToBaseline(BASELINE, current)).toEqual({ raised: [], dropped: [] })
  })

  it('shrinks on update, dropping fixed files', () => {
    const result = nextBaseline(BASELINE, counts({ 'relative-import': { 'a.ts': 1 } }))
    expect(result).toEqual({ baseline: { ...EMPTY, 'relative-import': { 'a.ts': 1 } } })
  })

  it('refuses to raise a count on update, even while another file shrinks', () => {
    const result = nextBaseline(BASELINE, counts({ 'relative-import': { 'a.ts': 1, 'b.ts': 2 } }))
    expect(result).toEqual({
      errors: ['refused to raise relative-import b.ts: 2 (baseline 1); fix it instead'],
    })
  })

  it('admits an untracked rule once with --init-rule, and only that rule', () => {
    const { 'bare-route-handler': _untracked, ...untracked } = BASELINE
    const current = counts({
      'relative-import': { 'a.ts': 3 },
      'bare-route-handler': { 'route.ts': 2 },
    })
    expect(nextBaseline(untracked, current, 'bare-route-handler')).toEqual({
      errors: ['refused to raise relative-import a.ts: 3 (baseline 2); fix it instead'],
    })
    const clean = counts({
      'relative-import': BASELINE['relative-import'],
      'bare-route-handler': { 'route.ts': 2 },
    })
    expect(nextBaseline(untracked, clean, 'bare-route-handler')).toEqual({
      baseline: { ...BASELINE, 'bare-route-handler': { 'route.ts': 2 } },
    })
  })

  it('refuses --init-rule for a rule the baseline already tracks, even when its debt is zero', () => {
    const current = counts({ 'bare-route-handler': { 'route.ts': 1 } })
    expect(nextBaseline(BASELINE, current, 'bare-route-handler')).toEqual({
      errors: [
        '--init-rule bare-route-handler: the baseline already tracks this rule, so its debt can only shrink. Fix the new hits instead.',
      ],
    })
  })

  it('refuses an untracked rule with hits unless --init-rule names it', () => {
    const { 'static-inline-style': _untracked, ...untracked } = BASELINE
    const current = counts({
      'relative-import': BASELINE['relative-import'],
      'static-inline-style': { 'a.tsx': 1 },
    })
    expect(nextBaseline(untracked, current)).toEqual({
      errors: [
        'static-inline-style is not in the baseline. Admit its existing hits once with --update --init-rule static-inline-style.',
      ],
    })
  })

  it('rejects an --init-rule that names no rule', () => {
    expect(nextBaseline(BASELINE, EMPTY, 'no-such-rule')).toEqual({
      errors: [
        '--init-rule no-such-rule: not a rule in this script (relative-import, text-size-literal, static-inline-style, api-db-import, bare-route-handler)',
      ],
    })
  })
})

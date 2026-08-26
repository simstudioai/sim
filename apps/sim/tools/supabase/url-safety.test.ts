/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { countTool } from '@/tools/supabase/count'
import { deleteTool } from '@/tools/supabase/delete'
import { getRowTool } from '@/tools/supabase/get_row'
import { insertTool } from '@/tools/supabase/insert'
import { invokeFunctionTool } from '@/tools/supabase/invoke_function'
import { queryTool } from '@/tools/supabase/query'
import { rpcTool } from '@/tools/supabase/rpc'
import { textSearchTool } from '@/tools/supabase/text_search'
import { updateTool } from '@/tools/supabase/update'
import { upsertTool } from '@/tools/supabase/upsert'
import { vectorSearchTool } from '@/tools/supabase/vector_search'
import type { ToolConfig } from '@/tools/types'

const PROJECT_ID = 'jdrkgepadsdopsntdlom'

/**
 * Values that must never reach a REST path position. These tools are guarded by
 * `validateDatabaseIdentifier` (allowlist `^[A-Za-z_][A-Za-z0-9_]*$`), which is
 * strictly stronger than `safeUrlPathSegment`; these tests pin that guard so a
 * future refactor cannot drop it and fall back to a bare `encodeURIComponent`,
 * which would map `..` straight through into the path.
 */
const TRAVERSAL_VECTORS = ['..', '.', '  ..  ', 'a/../../b', '\\..\\..'] as const

function buildUrl(tool: ToolConfig<any, any>, params: Record<string, unknown>): string {
  const url = tool.request?.url
  if (typeof url !== 'function') {
    throw new Error(`${tool.id} does not build its URL from params`)
  }
  return url(params as never)
}

const TABLE_TOOLS: Array<[string, ToolConfig<any, any>, Record<string, unknown>]> = [
  ['count', countTool, {}],
  ['delete', deleteTool, { filter: 'id=eq.1' }],
  ['get_row', getRowTool, { filter: 'id=eq.1' }],
  ['insert', insertTool, { data: {} }],
  ['query', queryTool, {}],
  ['text_search', textSearchTool, { query: 'hello', column: 'body' }],
  ['update', updateTool, { filter: 'id=eq.1', data: {} }],
  ['upsert', upsertTool, { data: {} }],
]

/**
 * Every tool that interpolates a caller-supplied function name into the path.
 * `invoke_function` guards with its own `validateFunctionName` rather than
 * `validateDatabaseIdentifier`, because Edge Function names are hyphenated
 * (`hello-world`) and the database-identifier allowlist rejects a hyphen. That
 * bespoke validator is pinned here so it cannot be dropped or loosened.
 */
const FUNCTION_TOOLS: Array<[string, ToolConfig<any, any>]> = [
  ['rpc', rpcTool],
  ['vector_search', vectorSearchTool],
  ['invoke_function', invokeFunctionTool],
]

const RPC_TOOLS: Array<[string, ToolConfig<any, any>]> = [
  ['rpc', rpcTool],
  ['vector_search', vectorSearchTool],
]

describe.each(TABLE_TOOLS)('%s rejects traversal in the table path', (_name, tool, extra) => {
  it.concurrent.each(TRAVERSAL_VECTORS)('rejects table %j', (table) => {
    expect(() => buildUrl(tool, { projectId: PROJECT_ID, table, ...extra })).toThrow(/table/)
  })

  it.concurrent('keeps the /rest/v1/<table> shape for a real table', () => {
    const url = new URL(buildUrl(tool, { projectId: PROJECT_ID, table: 'users', ...extra }))
    const segments = url.pathname.split('/')

    expect(segments).toHaveLength(4)
    expect(segments[1]).toBe('rest')
    expect(segments[2]).toBe('v1')
    expect(segments[3]).toBe('users')
    expect(url.host).toBe(`${PROJECT_ID}.supabase.co`)
  })
})

describe.each(FUNCTION_TOOLS)('%s rejects traversal in the function path', (_name, tool) => {
  it.concurrent.each(TRAVERSAL_VECTORS)('rejects functionName %j', (functionName) => {
    expect(() => buildUrl(tool, { projectId: PROJECT_ID, functionName })).toThrow(/function ?name/i)
  })
})

describe.each(RPC_TOOLS)('%s keeps the rpc path shape', (_name, tool) => {
  it.concurrent('keeps the /rest/v1/rpc/<fn> shape for a real function', () => {
    const url = new URL(buildUrl(tool, { projectId: PROJECT_ID, functionName: 'match_docs' }))
    const segments = url.pathname.split('/')

    expect(segments).toHaveLength(5)
    expect(segments[1]).toBe('rest')
    expect(segments[2]).toBe('v1')
    expect(segments[3]).toBe('rpc')
    expect(segments[4]).toBe('match_docs')
  })
})

/**
 * `filter` is a raw PostgREST query-string fragment appended after `?select=`.
 * A `#` anywhere in it opens a URL fragment, and `fetch` never transmits a
 * fragment — so the filter is silently truncated or dropped entirely. On
 * `supabase_delete` that turns `DELETE /users?select=*&id=eq.1` into
 * `DELETE /users?select=*&`, which matches every row.
 */
const FRAGMENT_FILTERS = ['#id=eq.1', 'name=eq.J#ohn', 'id=eq.1#', '  #x  '] as const

/**
 * Filter spellings the block's own wand prompt documents. These must survive
 * byte-identically — any re-encoding scheme that rewrites `(`, `)`, `,` or `*`
 * would change what PostgREST matches on a DELETE.
 */
const DOCUMENTED_FILTERS = [
  'id=eq.123',
  'age=gt.18&status=eq.active',
  'or=(status.eq.active,status.eq.pending)',
  'not.and=(status.eq.active,verified.eq.true)',
  'category=in.(tech,science,health)',
  'email=ilike.*@gmail.com',
  'profile_image=is.null',
  'tags=cs.{a,b}',
] as const

const FILTER_TOOLS: Array<[string, ToolConfig<any, any>, Record<string, unknown>]> = [
  ['count', countTool, {}],
  ['delete', deleteTool, {}],
  ['get_row', getRowTool, {}],
  ['query', queryTool, {}],
  ['update', updateTool, { data: {} }],
]

describe.each(FILTER_TOOLS)('%s guards the filter query fragment', (_name, tool, extra) => {
  it.concurrent.each(FRAGMENT_FILTERS)('rejects filter %j instead of dropping it', (filter) => {
    expect(() =>
      buildUrl(tool, { projectId: PROJECT_ID, table: 'users', filter, ...extra })
    ).toThrow(/filter/)
  })

  it.concurrent.each(DOCUMENTED_FILTERS)('passes documented filter %j through intact', (filter) => {
    const built = buildUrl(tool, { projectId: PROJECT_ID, table: 'users', filter, ...extra })

    expect(built).toContain(`&${filter}`)
    expect(new URL(built).hash).toBe('')
  })
})

describe('get_row applies limit=1 ahead of the caller filter', () => {
  it.concurrent('emits limit=1 before the filter, not after it', () => {
    const built = buildUrl(getRowTool, {
      projectId: PROJECT_ID,
      table: 'users',
      filter: 'id=eq.1',
    })

    expect(built.indexOf('&limit=1')).toBeLessThan(built.indexOf('&id=eq.1'))
  })

  it.concurrent('keeps limit=1 in the query even for a multi-condition filter', () => {
    const url = new URL(
      buildUrl(getRowTool, {
        projectId: PROJECT_ID,
        table: 'users',
        filter: 'age=gt.18&status=eq.active',
      })
    )

    expect(url.searchParams.get('limit')).toBe('1')
    expect(url.searchParams.get('age')).toBe('gt.18')
    expect(url.searchParams.get('status')).toBe('eq.active')
    expect(url.hash).toBe('')
  })
})

describe('the destructive shape this guard exists for', () => {
  it.concurrent('never lets delete build a filterless DELETE url', () => {
    for (const filter of [...FRAGMENT_FILTERS, '', '   ']) {
      let built: string | null = null
      try {
        built = buildUrl(deleteTool, { projectId: PROJECT_ID, table: 'users', filter })
      } catch {
        continue
      }
      const search = new URL(built).search

      expect(search).not.toBe('?select=*&')
      expect(search).not.toBe('?select=*')
    }
  })
})

describe('query guards the order fragment the same way', () => {
  it.concurrent.each(['created_at#', '#col', 'a#b DESC'] as const)(
    'rejects orderBy %j instead of dropping limit and offset',
    (orderBy) => {
      expect(() =>
        buildUrl(queryTool, { projectId: PROJECT_ID, table: 'users', orderBy, limit: 5 })
      ).toThrow(/orderBy/)
    }
  )

  it.concurrent('still builds a normal ordered, paginated query', () => {
    const url = new URL(
      buildUrl(queryTool, {
        projectId: PROJECT_ID,
        table: 'users',
        orderBy: 'created_at DESC',
        limit: 5,
        offset: 10,
      })
    )

    expect(url.searchParams.get('order')).toBe('created_at.desc')
    expect(url.searchParams.get('limit')).toBe('5')
    expect(url.searchParams.get('offset')).toBe('10')
  })
})

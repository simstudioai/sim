/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { countTool } from '@/tools/supabase/count'
import { deleteTool } from '@/tools/supabase/delete'
import { getRowTool } from '@/tools/supabase/get_row'
import { insertTool } from '@/tools/supabase/insert'
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

const FUNCTION_TOOLS: Array<[string, ToolConfig<any, any>]> = [
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

describe.each(FUNCTION_TOOLS)('%s rejects traversal in the rpc path', (_name, tool) => {
  it.concurrent.each(TRAVERSAL_VECTORS)('rejects functionName %j', (functionName) => {
    expect(() => buildUrl(tool, { projectId: PROJECT_ID, functionName })).toThrow(/functionName/)
  })

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

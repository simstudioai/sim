/**
 * @vitest-environment node
 *
 * Guards the Algolia tools that put an index name into a request **body**
 * against it arriving as a JSON number.
 *
 * The path-zone sites already run through `safeUrlPathSegment`, whose
 * `toGuardedString` stringifies a number; the body-zone sites kept a bare
 * `.trim()`. An index literally named `2024` is ordinary, and a
 * `visibility: 'user-or-llm'` slot filled with `2024` reaches the builder as a
 * JSON number — `TypeError: x.trim is not a function`, surfaced as a tool crash
 * rather than a validation error. Sending the string `"undefined"` as an index
 * name instead of reporting the missing parameter would be no better, so the
 * nullish case is rejected before coercion.
 */
import { describe, expect, it } from 'vitest'
import { copyMoveIndexTool } from '@/tools/algolia/copy_move_index'
import { getRecordsTool } from '@/tools/algolia/get_records'
import { searchTool } from '@/tools/algolia/search'
import type { ToolConfig } from '@/tools/types'

type AnyTool = ToolConfig<any, any>

const BASE = { applicationId: 'APPID', apiKey: 'KEY' }

function bodyOf(tool: AnyTool, params: Record<string, unknown>): Record<string, any> {
  const build = tool.request.body as (p: Record<string, unknown>) => Record<string, any>
  return build({ ...BASE, ...params })
}

describe('algolia_search indexName coercion', () => {
  it('accepts a numeric index name emitted as a JSON number', () => {
    expect(
      bodyOf(searchTool as AnyTool, { indexName: 2024, query: 'q' }).requests[0].indexName
    ).toBe('2024')
  })

  it('still trims a string index name byte-identically', () => {
    expect(bodyOf(searchTool as AnyTool, { indexName: ' products ', query: 'q' })).toEqual({
      requests: [{ indexName: 'products', query: 'q' }],
    })
  })

  it('reports a missing required index name by name rather than crashing', () => {
    expect(() => bodyOf(searchTool as AnyTool, { query: 'q' })).toThrow(/indexName/)
  })
})

describe('algolia_copy_move_index destination coercion', () => {
  it('accepts a numeric destination emitted as a JSON number', () => {
    expect(
      bodyOf(copyMoveIndexTool as AnyTool, {
        indexName: 'src',
        destination: 2025,
        operation: 'copy',
      }).destination
    ).toBe('2025')
  })

  it('still trims a string destination byte-identically', () => {
    expect(
      bodyOf(copyMoveIndexTool as AnyTool, {
        indexName: 'src',
        destination: ' dest ',
        operation: 'move',
      })
    ).toEqual({ operation: 'move', destination: 'dest' })
  })

  it('reports a missing required destination by name rather than crashing', () => {
    expect(() =>
      bodyOf(copyMoveIndexTool as AnyTool, { indexName: 'src', operation: 'copy' })
    ).toThrow(/destination/)
  })
})

describe('algolia_get_records indexName coercion', () => {
  it('accepts a numeric fallback index name emitted as a JSON number', () => {
    const body = bodyOf(getRecordsTool as AnyTool, {
      indexName: 2024,
      requests: [{ objectID: 'a' }],
    })
    expect(body.requests).toEqual([{ objectID: 'a', indexName: '2024' }])
  })

  it('accepts a numeric per-request index name', () => {
    const body = bodyOf(getRecordsTool as AnyTool, {
      indexName: 'fallback',
      requests: [{ objectID: 'a', indexName: 2024 }],
    })
    expect(body.requests).toEqual([{ objectID: 'a', indexName: '2024' }])
  })

  it('still trims string index names byte-identically', () => {
    const body = bodyOf(getRecordsTool as AnyTool, {
      indexName: ' fallback ',
      requests: [{ objectID: 'a' }, { objectID: 'b', indexName: ' own ' }],
    })
    expect(body.requests).toEqual([
      { objectID: 'a', indexName: 'fallback' },
      { objectID: 'b', indexName: 'own' },
    ])
  })
})

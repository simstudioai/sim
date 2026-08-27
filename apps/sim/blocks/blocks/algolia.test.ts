/**
 * @vitest-environment node
 *
 * Guards the Algolia block's pagination coercion.
 *
 * `page`/`hitsPerPage` leave the canvas as short-input strings, and
 * `tools.config.params` coerces them so the tools' declared `type: 'number'`
 * holds. The coercion must not manufacture a value: `Number('')` is `0`, so
 * trimming a whitespace-only string before parsing turned "the user typed
 * spaces" into a request for page 0 / 0 hits per page — and because the block
 * loop only drops the exactly-empty string, a whitespace-only field reached it.
 * Passing such a value through untouched lets `algolia_list_indices`'
 * `paginationValue` reject it by name, which is the single validator this
 * repo wants doing that job.
 */
import { describe, expect, it } from 'vitest'
import { AlgoliaBlock } from '@/blocks/blocks/algolia'
import { listIndicesTool } from '@/tools/algolia/list_indices'

function mapParams(params: Record<string, unknown>): Record<string, unknown> {
  const build = AlgoliaBlock.tools.config?.params
  if (!build) throw new Error('algolia tools.config.params is not defined')
  return build(params) as Record<string, unknown>
}

const BASE = { operation: 'list_indices', applicationId: 'APPID', apiKey: 'KEY' }

describe('Algolia block pagination coercion', () => {
  it.each(['   ', '\t', '\n  '])('does not turn a whitespace-only page (%j) into 0', (blank) => {
    const result = mapParams({ ...BASE, page: blank })
    expect(result.page).not.toBe(0)
    expect(result.page).toBe(blank)
  })

  it.each(['   ', '\t', '\n  '])(
    'does not turn a whitespace-only hitsPerPage (%j) into 0',
    (blank) => {
      const result = mapParams({ ...BASE, hitsPerPage: blank })
      expect(result.hitsPerPage).not.toBe(0)
      expect(result.hitsPerPage).toBe(blank)
    }
  )

  it('lets the tool-side validator reject the whitespace value by name', () => {
    const build = listIndicesTool.request.url as (p: Record<string, unknown>) => string
    expect(() => build(mapParams({ ...BASE, page: '  ' }))).toThrow(/page/)
    expect(() => build(mapParams({ ...BASE, hitsPerPage: '  ' }))).toThrow(/hitsPerPage/)
  })

  it('still drops an exactly-empty short-input, as today', () => {
    const result = mapParams({ ...BASE, page: '', hitsPerPage: '' })
    expect(Object.hasOwn(result, 'page')).toBe(false)
    expect(Object.hasOwn(result, 'hitsPerPage')).toBe(false)
  })

  it('coerces legitimate numeric strings byte-identically to today', () => {
    expect(mapParams({ ...BASE, page: '0', hitsPerPage: '100' })).toMatchObject({
      page: 0,
      hitsPerPage: 100,
    })
    expect(mapParams({ ...BASE, page: ' 3 ', hitsPerPage: ' 25 ' })).toMatchObject({
      page: 3,
      hitsPerPage: 25,
    })
    expect(mapParams({ ...BASE, page: 2, hitsPerPage: 50 })).toMatchObject({
      page: 2,
      hitsPerPage: 50,
    })
  })

  it('still passes a non-numeric value through untouched so the tool names it', () => {
    expect(mapParams({ ...BASE, page: 'abc' }).page).toBe('abc')
    expect(mapParams({ ...BASE, page: '0&hitsPerPage=1000' }).page).toBe('0&hitsPerPage=1000')
  })
})

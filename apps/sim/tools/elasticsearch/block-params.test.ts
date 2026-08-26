/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/components/icons', () => ({
  ElasticsearchIcon: () => null,
}))

import { ElasticsearchBlock } from '@/blocks/blocks/elasticsearch'

function transform(params: Record<string, unknown>): Record<string, unknown> {
  const build = ElasticsearchBlock.tools.config?.params
  if (!build) throw new Error('ElasticsearchBlock.tools.config.params is not defined')
  return build(params) as Record<string, unknown>
}

describe('elasticsearch block param mapping', () => {
  it('forwards a numeric size of 0 instead of dropping it', () => {
    expect(transform({ size: 0 }).size).toBe(0)
  })

  it('forwards a numeric retryOnConflict of 0', () => {
    expect(transform({ retryOnConflict: 0 }).retryOnConflict).toBe(0)
  })

  it('forwards a numeric from of 0', () => {
    expect(transform({ from: 0 }).from).toBe(0)
  })

  it('omits size when the subblock was never touched', () => {
    expect(transform({ size: '' }).size).toBeUndefined()
  })

  it('throws instead of forwarding NaN for a non-numeric size', () => {
    expect(() => transform({ size: 'ten' })).toThrow(/size must be a number/)
  })

  it('maps the timeout subblock to esTimeout and clears the reserved transport param', () => {
    const result = transform({ timeout: '30' })

    expect(result.esTimeout).toBe('30s')
    expect(result.timeout).toBeUndefined()
    expect(Object.hasOwn(result, 'timeout')).toBe(true)
  })

  it('leaves a minute duration alone rather than rewriting "1m" to "1ms"', () => {
    expect(transform({ timeout: '1m' }).esTimeout).toBe('1m')
  })

  it('preserves an explicit seconds suffix', () => {
    expect(transform({ timeout: '45s' }).esTimeout).toBe('45s')
  })

  it('always unsets timeout, so a raw timeout on inputs cannot reach the transport', () => {
    const result = transform({})

    expect(Object.hasOwn(result, 'timeout')).toBe(true)
    expect(result.timeout).toBeUndefined()
  })
})

describe('elasticsearch block outputs', () => {
  it('declares the flattened get_index outputs', () => {
    expect(ElasticsearchBlock.outputs.index?.type).toBe('string')
    expect(ElasticsearchBlock.outputs.aliases?.type).toBe('json')
    expect(ElasticsearchBlock.outputs.mappings?.type).toBe('json')
    expect(ElasticsearchBlock.outputs.settings?.type).toBe('json')
  })

  it('does not advertise found: false or a "not_found" result', () => {
    expect(ElasticsearchBlock.outputs.found?.description).toMatch(/Always true/)
    expect(ElasticsearchBlock.outputs.result?.description).toMatch(/rather than returning/)
  })

  it('moves optional knobs behind the advanced toggle', () => {
    const advanced = new Set(
      ElasticsearchBlock.subBlocks.filter((b) => b.mode === 'advanced').map((b) => b.id)
    )

    for (const id of ['from', 'sort', 'sourceIncludes', 'sourceExcludes', 'refresh', 'timeout']) {
      expect(advanced.has(id)).toBe(true)
    }
  })
})

describe('elasticsearch block declares no unreachable aggregations', () => {
  it('does not advertise an aggregations output, since no subBlock or input feeds one', () => {
    expect(ElasticsearchBlock.outputs).not.toHaveProperty('aggregations')
    expect(ElasticsearchBlock.inputs).not.toHaveProperty('aggs')
    expect(ElasticsearchBlock.subBlocks.some((b) => b.id === 'aggs')).toBe(false)
  })

  it('declares the get_index multi-target outputs so a wildcard result is reachable', () => {
    expect(ElasticsearchBlock.outputs.matchedCount?.type).toBe('number')
    expect(ElasticsearchBlock.outputs.indices?.type).toBe('json')
  })

  it('still maps a bare timeout to seconds via the shared tool-side normalizer', () => {
    expect(transform({ timeout: '30' }).esTimeout).toBe('30s')
    expect(transform({ timeout: '1m' }).esTimeout).toBe('1m')
    expect(transform({ timeout: '45s' }).esTimeout).toBe('45s')
  })
})

/**
 * `_bulk` legitimately runs against `/_bulk` with a per-action `_index`, which
 * the block's own `operations` placeholder demonstrates
 * (`{"index":{"_index":"my-index","_id":"1"}}`). `bulk.ts` therefore declares
 * `index` optional, and `bulk`'s URL builder branches on its absence — the
 * block marking it `required: true` blocked a call the tool supports.
 */
describe('elasticsearch block index requirement agrees with the tools', () => {
  const indexSubBlock = ElasticsearchBlock.subBlocks.find((b) => b.id === 'index')

  it('does not require index for bulk', () => {
    expect(indexSubBlock?.required).not.toBe(true)

    const required = indexSubBlock?.required as { field: string; value: string[] }

    expect(required.field).toBe('operation')
    expect(required.value).not.toContain('elasticsearch_bulk')
  })

  it('still renders the index field for bulk, where it sets the default target', () => {
    const condition = indexSubBlock?.condition as { field: string; value: string[] }

    expect(condition.value).toContain('elasticsearch_bulk')
  })

  it('keeps requiring index for every operation that addresses one', () => {
    const required = indexSubBlock?.required as { field: string; value: string[] }

    for (const operation of [
      'elasticsearch_search',
      'elasticsearch_index_document',
      'elasticsearch_get_document',
      'elasticsearch_update_document',
      'elasticsearch_delete_document',
      'elasticsearch_count',
      'elasticsearch_create_index',
      'elasticsearch_delete_index',
      'elasticsearch_get_index',
    ]) {
      expect(required.value).toContain(operation)
    }
  })
})

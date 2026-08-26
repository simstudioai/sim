/**
 * @vitest-environment node
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseJSONBuffer, parseJSONLBuffer } from '@/lib/file-parsers/json-parser'

describe('JSON parser complexity limits', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('rejects excessive nesting before serializing the parsed value', async () => {
    const content = `${'['.repeat(501)}0${']'.repeat(501)}`
    const stringify = vi.spyOn(JSON, 'stringify')

    await expect(parseJSONBuffer(Buffer.from(content))).rejects.toMatchObject({
      code: 'complexity_limit',
    })
    expect(stringify).not.toHaveBeenCalled()
  })

  it('validates every JSONL item before serializing the aggregate', async () => {
    const nested = `${'['.repeat(501)}0${']'.repeat(501)}`
    const stringify = vi.spyOn(JSON, 'stringify')

    await expect(parseJSONLBuffer(Buffer.from(`{}\n${nested}`))).rejects.toMatchObject({
      code: 'complexity_limit',
    })
    expect(stringify).not.toHaveBeenCalled()
  })

  it('reports the deepest JSONL item instead of only the first', async () => {
    const result = await parseJSONLBuffer(Buffer.from('{}\n{"nested":{"value":true}}'))

    expect(result.metadata).toMatchObject({ itemCount: 2, depth: 3 })
  })

  it('preserves ordinary JSON content and metadata', async () => {
    const result = await parseJSONBuffer(Buffer.from('{"items":[1,2],"name":"test"}'))

    expect(JSON.parse(result.content)).toEqual({ items: [1, 2], name: 'test' })
    expect(result.metadata).toMatchObject({ isArray: false, keys: ['items', 'name'], depth: 2 })
  })
})

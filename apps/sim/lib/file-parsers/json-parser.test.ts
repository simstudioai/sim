import { describe, expect, it, vi } from 'vitest'
import { parseJSONBuffer, parseJSONLBuffer } from '@/lib/file-parsers/json-parser'

describe('JSON parser complexity limits', () => {
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

  it('still rejects JSON that is invalid even after comment stripping', async () => {
    await expect(parseJSONBuffer(Buffer.from('{ "a": [1, 2 }'))).rejects.toMatchObject({
      code: 'invalid_format',
    })
  })
})

import { describe, expect, it, vi } from 'vitest'
import { filterOutputForLog } from '@/executor/utils/output-filter'

vi.mock('@/blocks', () => ({
  getBlock: () => undefined,
}))

describe('output filtering', () => {
  it('preserves special top-level output keys as own fields', () => {
    const rawOutput: Record<string, unknown> = {}
    Object.defineProperty(rawOutput, 'constructor', {
      value: { safe: true },
      enumerable: true,
    })

    const output = filterOutputForLog('', rawOutput)

    expect(Object.hasOwn(output, 'constructor')).toBe(true)
    expect(output.constructor).toEqual({ safe: true })
    expect(Object.getPrototypeOf(output)).toBe(Object.prototype)
  })

  it('drops a globally hidden key at the TOP level, not just nested', () => {
    // `getBlock` is mocked to undefined here, which is exactly a custom block's situation:
    // its publisher-curated outputs never declare `childTraceSpans` as hiddenFromDisplay,
    // so without a global rule the child workspace's spans persist onto the block log and
    // from there onto the trace span's output — past every per-viewer access check.
    const output = filterOutputForLog('custom_block_abc', {
      answer: 42,
      childTraceSpans: [{ id: 's1', name: 'Publisher Agent', type: 'agent' }],
    } as never)

    expect(output).not.toHaveProperty('childTraceSpans')
    expect(output.answer).toBe(42)
  })

  it('shares untouched nested output with the block state instead of copying it', () => {
    const rows = [{ id: 1, data: { name: 'a' } }]
    const nestedSpans = { childTraceSpans: [{ id: 's1' }], kept: { value: 1 } }
    const blockOutput = { rows, nested: nestedSpans }

    const output = filterOutputForLog('table', blockOutput as never)

    expect(output.rows).toBe(rows)
    expect(output.nested).not.toBe(nestedSpans)
    expect(output.nested).not.toHaveProperty('childTraceSpans')
    expect((output.nested as typeof nestedSpans).kept).toBe(nestedSpans.kept)
  })

  it('keeps the file size a block completed with when hydration later updates it in place', () => {
    const file = { id: 'f1', key: 'k1', url: 'u', name: 'deck.pptx', size: 10, type: 'pptx' }
    const blockOutput = { file, rows: [{ id: 1 }] }

    const output = filterOutputForLog('function', blockOutput as never)
    file.size = 4096

    expect((output.file as typeof file).size).toBe(10)
    expect(output.rows).toBe(blockOutput.rows)
  })
})

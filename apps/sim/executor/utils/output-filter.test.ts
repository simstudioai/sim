/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import { filterHiddenOutputKeys } from '@/lib/logs/execution/trace-spans/trace-spans'
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

  it('preserves special nested output keys as own fields', () => {
    const nested: Record<string, unknown> = {}
    Object.defineProperty(nested, '__proto__', {
      value: { safe: true },
      enumerable: true,
    })

    const filtered = filterHiddenOutputKeys({
      nested,
    }) as { nested: Record<string, unknown> }

    expect(Object.hasOwn(filtered.nested, '__proto__')).toBe(true)
    expect(filtered.nested.__proto__).toEqual({ safe: true })
    expect(Object.getPrototypeOf(filtered.nested)).toBe(Object.prototype)
  })
})

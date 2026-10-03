import { describe, expect, it } from 'vitest'
import type { ConsoleEntry } from './types'
import { normalizeConsoleOutput, TERMINAL_CONSOLE_LIMITS, trimConsoleEntries } from './utils'

function makeEntry(id: string, executionId: string, workflowId = 'wf-1'): ConsoleEntry {
  return {
    id,
    executionId,
    workflowId,
    blockId: `block-${id}`,
    blockName: `Block ${id}`,
    blockType: 'function',
    executionOrder: Number.parseInt(id.replace(/\D/g, ''), 10) || 0,
    timestamp: '2025-01-01T00:00:00.000Z',
  }
}

describe('terminal console utils', () => {
  it('resolves true circular references without infinite recursion', () => {
    const circular: { name: string; self?: unknown } = { name: 'root' }
    circular.self = circular

    const output = normalizeConsoleOutput(circular) as { name: string; self: unknown }

    expect(output.name).toBe('root')
    expect(output.self).toBe('[Circular]')
  })

  it('renders a value shared across sibling positions fully (not circular)', () => {
    const shared = { x: 1 }
    const output = normalizeConsoleOutput({ a: shared, b: shared }) as {
      a: { x: number }
      b: { x: number }
    }

    expect(output.a).toEqual({ x: 1 })
    expect(output.b).toEqual({ x: 1 })
  })

  it('preserves the newest oversized execution by trimming within it first', () => {
    const newestEntries = Array.from({ length: 5_100 }, (_, index) =>
      makeEntry(`new-${index}`, 'exec-new')
    )
    const olderEntries = Array.from({ length: 25 }, (_, index) =>
      makeEntry(`old-${index}`, 'exec-old')
    )
    const trimmed = trimConsoleEntries([...newestEntries, ...olderEntries])

    expect(trimmed).toHaveLength(TERMINAL_CONSOLE_LIMITS.MAX_ENTRIES_PER_WORKFLOW)
    expect(trimmed.every((entry) => entry.executionId === 'exec-new')).toBe(true)
    expect(trimmed[0].id).toBe('new-0')
    expect(trimmed.at(-1)?.id).toBe(`new-${TERMINAL_CONSOLE_LIMITS.MAX_ENTRIES_PER_WORKFLOW - 1}`)
  })

  it('keeps older whole executions when they still fit after the newest run', () => {
    const newestEntries = Array.from({ length: 4_990 }, (_, index) =>
      makeEntry(`new-${index}`, 'exec-new')
    )
    const olderEntries = Array.from({ length: 10 }, (_, index) =>
      makeEntry(`old-${index}`, 'exec-old')
    )

    const trimmed = trimConsoleEntries([...newestEntries, ...olderEntries])

    expect(trimmed).toHaveLength(5_000)
    expect(trimmed.filter((entry) => entry.executionId === 'exec-new')).toHaveLength(4_990)
    expect(trimmed.filter((entry) => entry.executionId === 'exec-old')).toHaveLength(10)
  })
})

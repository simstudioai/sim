/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { ConsoleEntry } from './types'
import {
  normalizeConsoleOutput,
  safeConsoleStringify,
  TERMINAL_CONSOLE_LIMITS,
  trimConsoleEntries,
} from './utils'

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
  it('safely stringifies circular values', () => {
    const circular: { name: string; self?: unknown } = { name: 'root' }
    circular.self = circular

    const result = safeConsoleStringify(circular)

    expect(result).toContain('[Circular]')
    expect(result).toContain('"name": "root"')
  })

  it('truncates oversized nested strings in console output', () => {
    const output = normalizeConsoleOutput({
      stdout: 'x'.repeat(TERMINAL_CONSOLE_LIMITS.MAX_STRING_LENGTH + 100),
    })

    expect(output?.stdout).toContain('[truncated 100 chars]')
  })

  it('caps oversized normalized payloads with a preview object', () => {
    const output = normalizeConsoleOutput({
      a: 'x'.repeat(100_000),
      b: 'y'.repeat(100_000),
      c: 'z'.repeat(100_000),
      d: 'q'.repeat(100_000),
      e: 'r'.repeat(100_000),
      f: 's'.repeat(100_000),
    }) as Record<string, unknown>

    expect(output.__simTruncated).toBe(true)
    expect(typeof output.__simPreview).toBe('string')
    expect(typeof output.__simByteLength).toBe('number')
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

/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  isLargeArrayManifestMock,
  isLargeValueRefMock,
  readLargeArrayManifestSliceMock,
  materializeLargeArrayManifestMock,
  materializeLargeValueRefMock,
} = vi.hoisted(() => ({
  isLargeArrayManifestMock: vi.fn(),
  isLargeValueRefMock: vi.fn(),
  readLargeArrayManifestSliceMock: vi.fn(),
  materializeLargeArrayManifestMock: vi.fn(),
  materializeLargeValueRefMock: vi.fn(),
}))

vi.mock('@/lib/execution/payloads/large-array-manifest-metadata', () => ({
  isLargeArrayManifest: isLargeArrayManifestMock,
}))
vi.mock('@/lib/execution/payloads/large-value-ref', () => ({
  isLargeValueRef: isLargeValueRefMock,
}))
vi.mock('@/lib/execution/payloads/large-array-manifest', () => ({
  readLargeArrayManifestSlice: readLargeArrayManifestSliceMock,
  materializeLargeArrayManifest: materializeLargeArrayManifestMock,
}))
vi.mock('@/lib/execution/payloads/store', () => ({
  materializeLargeValueRef: materializeLargeValueRefMock,
}))

import type { TraceSpan } from '@/lib/logs/types'
import { grepSpans, type LogViewContext, toFull, toOverview } from './log-views'

const ctx: LogViewContext = {
  workspaceId: 'ws-1',
  workflowId: 'wf-1',
  executionId: 'exec-1',
}

// Fixture helpers — the mocked type guards key off `__sim`.
const manifest = (totalCount: number, preview: unknown[] = []) => ({
  __sim: 'manifest',
  totalCount,
  preview,
})
const ref = (preview: unknown) => ({ __sim: 'ref', preview, size: 100 })

function span(overrides: Partial<TraceSpan> = {}): TraceSpan {
  return {
    id: 'span-1',
    name: 'Agent 1',
    type: 'agent',
    duration: 100,
    startTime: '2026-01-01T00:00:00.000Z',
    endTime: '2026-01-01T00:00:00.100Z',
    ...overrides,
  } as TraceSpan
}

beforeEach(() => {
  vi.clearAllMocks()
  isLargeArrayManifestMock.mockImplementation((v: any) => v?.__sim === 'manifest')
  isLargeValueRefMock.mockImplementation((v: any) => v?.__sim === 'ref')
})

describe('toOverview', () => {
  it('keeps timing/cost/hierarchy and omits input/output without materializing refs', () => {
    const spans: TraceSpan[] = [
      span({
        id: 'root',
        cost: { total: 0.5 },
        input: { secret: 'in' },
        output: ref('out-preview') as unknown as Record<string, unknown>,
        children: [span({ id: 'child', name: 'Tool', type: 'tool' })],
      }),
    ]

    const out = toOverview(spans)

    expect(out[0]).toMatchObject({
      id: 'root',
      name: 'Agent 1',
      type: 'agent',
      durationMs: 100,
      cost: { total: 0.5 },
    })
    expect(out[0]).not.toHaveProperty('input')
    expect(out[0]).not.toHaveProperty('output')
    expect(out[0].children?.[0]).toMatchObject({ id: 'child', name: 'Tool' })
    expect(materializeLargeArrayManifestMock).not.toHaveBeenCalled()
    expect(materializeLargeValueRefMock).not.toHaveBeenCalled()
  })
})

describe('toFull', () => {
  it('includes inline input/output', async () => {
    const out = await toFull([span({ input: { a: 1 }, output: { b: 2 } })], ctx)
    expect(out[0]).toMatchObject({ input: { a: 1 }, output: { b: 2 } })
  })

  it('block scoping returns only the selected subtree', async () => {
    const spans: TraceSpan[] = [
      span({ id: 's1', blockId: 'blk-a', name: 'A' }),
      span({ id: 's2', blockId: 'blk-b', name: 'B', output: { keep: true } }),
    ]
    const out = await toFull(spans, ctx, { blockId: 'blk-b' })
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ blockId: 'blk-b', output: { keep: true } })
  })

  it('materializes a large-array manifest field', async () => {
    materializeLargeArrayManifestMock.mockResolvedValue([1, 2, 3])
    const out = await toFull([span({ output: manifest(3) as any })], ctx)
    expect(out[0].output).toEqual([1, 2, 3])
    expect(materializeLargeArrayManifestMock).toHaveBeenCalledTimes(1)
  })

  it('falls back to ref preview when a single ref is unavailable', async () => {
    materializeLargeValueRefMock.mockResolvedValue(undefined)
    const out = await toFull([span({ output: ref('the-preview') as any })], ctx)
    expect(out[0].output).toBe('the-preview')
  })
})

describe('grepSpans', () => {
  it('matches inline output text and error text', async () => {
    const spans = [
      span({ output: { msg: 'request timeout occurred' }, errorMessage: 'boom failure' }),
    ]

    const outMatch = await grepSpans(spans, 'timeout', ctx)
    expect(outMatch.matches.some((m) => m.field === 'output')).toBe(true)
    expect(outMatch.truncated).toBe(false)

    const errMatch = await grepSpans(spans, 'boom', ctx)
    expect(errMatch.matches.some((m) => m.field === 'error')).toBe(true)
  })

  it('streams a large-array manifest slice-by-slice with advancing offsets', async () => {
    // totalCount 500, batch 200 → starts 0, 200, 400 (3 slices). Needle in slice 3.
    readLargeArrayManifestSliceMock.mockImplementation(async (_m: unknown, start: number) => {
      if (start === 400) return [{ v: 'found the needle here' }]
      return [{ v: 'nothing' }]
    })
    const spans = [span({ output: manifest(500) as any })]

    const result = await grepSpans(spans, 'needle', ctx)

    expect(result.matches.some((m) => m.field === 'output')).toBe(true)
    const starts = readLargeArrayManifestSliceMock.mock.calls.map((c) => c[1])
    expect(starts).toEqual([0, 200, 400])
  })

  it('caps matches and marks truncated', async () => {
    const spans = [span({ id: 'a', name: 'needle one', output: { v: 'needle two' } })]
    const result = await grepSpans(spans, 'needle', ctx, { maxMatches: 1 })
    expect(result.matches).toHaveLength(1)
    expect(result.truncated).toBe(true)
  })

  it('falls back to ref preview when ref access is rejected (no throw)', async () => {
    materializeLargeValueRefMock.mockRejectedValue(new Error('not available in this execution'))
    const spans = [span({ output: ref('secret-token') as any })]
    const result = await grepSpans(spans, 'secret-token', ctx)
    expect(result.matches.some((m) => m.field === 'output')).toBe(true)
  })

  it('falls back to literal substring on invalid regex', async () => {
    const spans = [span({ output: { v: 'value a(b found' } })]
    const result = await grepSpans(spans, '(', ctx)
    expect(result.matches.some((m) => m.field === 'output')).toBe(true)
  })

  it('returns empty for empty traceSpans', async () => {
    const result = await grepSpans([], 'anything', ctx)
    expect(result.matches).toEqual([])
    expect(result.truncated).toBe(false)
  })
})

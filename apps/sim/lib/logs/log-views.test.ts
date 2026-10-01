import { describe, expect, it } from 'vitest'
import { toOverview } from '@/lib/logs/log-views'
import type { TraceSpan } from '@/lib/logs/types'

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
  })
})

import { describe, expect, it, vi } from 'vitest'

vi.mock('@/blocks', () => ({
  getBlock: () => ({
    subBlocks: [
      { id: 'fields', type: 'short-input', mode: 'advanced' },
      { id: 'query', type: 'short-input' },
    ],
  }),
}))

import { assertAppInputBoundary } from '@/lib/apps/app-input-boundary'

describe('assertAppInputBoundary', () => {
  it('rejects a public input wired into provider field selection', () => {
    expect(
      assertAppInputBoundary({
        startBlockId: 'start-1',
        fieldNames: ['fields'],
        blocks: {
          'start-1': { id: 'start-1', type: 'start_trigger', subBlocks: {} },
          tiktok: {
            id: 'tiktok',
            type: 'tiktok',
            subBlocks: { fields: { value: '<start.fields>' } },
          },
        },
      })
    ).toEqual(
      expect.objectContaining({
        ok: false,
        code: 'PROVIDER_CONFIG_INPUT_EXPOSED',
      })
    )
  })

  it('allows meaningful user input wired into a normal provider parameter', () => {
    expect(
      assertAppInputBoundary({
        startBlockId: 'start-1',
        fieldNames: ['query'],
        blocks: {
          'start-1': { id: 'start-1', type: 'start_trigger', subBlocks: {} },
          integration: {
            id: 'integration',
            type: 'search',
            subBlocks: { query: { value: '<start.query>' } },
          },
        },
      })
    ).toEqual({ ok: true })
  })
})

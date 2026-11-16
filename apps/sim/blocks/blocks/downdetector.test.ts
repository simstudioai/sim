import { describe, expect, it } from 'vitest'
import { DowndetectorBlock } from '@/blocks/blocks/downdetector'

describe('Downdetector agent tool calls', () => {
  it('forwards the model page token for Get Site Companies', () => {
    const mapper = DowndetectorBlock.tools.config?.params
    if (!mapper) throw new Error('Downdetector block has no params mapper')

    const result = mapper(
      { siteId: '12', page: 'opaque-token' },
      { operation: 'downdetector_get_site_companies' }
    )

    expect(result.page).toBe('opaque-token')
  })
})

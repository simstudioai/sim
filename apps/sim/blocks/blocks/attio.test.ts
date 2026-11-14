import { triggersMock } from '@sim/testing/mocks/triggers.mock'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/triggers', () => triggersMock)

import { AttioBlock } from '@/blocks/blocks/attio'

describe('Attio agent operation resolution', () => {
  it('maps the selected list when the operation arrives only in the tool-call context', () => {
    const mapper = AttioBlock.tools.config?.params
    if (!mapper) throw new Error('Attio block has no params mapper')

    const mapped = mapper(
      { oauthCredential: 'cred', listIdOrSlug: 'list-1' },
      { operation: 'get_list' }
    )

    expect(mapped.list).toBe('list-1')
  })
})

import { createBlock } from '@sim/testing/factories/block.factory'
import { blocksMock } from '@sim/testing/mocks/blocks.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as blocks from '@/blocks'
import { GoogleAdsBlock } from '@/blocks/blocks/google_ads'
import { Serializer } from '@/serializer'
import type { BlockState } from '@/stores/workflows/workflow/types'

vi.mock('@/blocks', () => blocksMock)

describe('Google Ads workflow credential migration', () => {
  beforeEach(() => {
    vi.spyOn(blocks, 'getBlock').mockReturnValue(GoogleAdsBlock)
  })

  it.each([undefined, '{{RETIRED_ADS_TOKEN}}'])(
    'serializes an OAuth reporting workflow without resolving retired token %s',
    (legacyToken) => {
      const block: BlockState = createBlock({
        type: 'google_ads',
        name: 'Ads report',
        subBlocks: {
          operation: { id: 'operation', type: 'dropdown', value: 'search' },
          credential: { id: 'credential', type: 'oauth-input', value: 'ads-credential' },
          customerId: { id: 'customerId', type: 'short-input', value: '1234567890' },
          query: { id: 'query', type: 'long-input', value: 'SELECT campaign.id FROM campaign' },
          ...(legacyToken && {
            developerToken: { id: 'developerToken', type: 'short-input', value: legacyToken },
          }),
        },
      })
      const serialized = new Serializer().serializeWorkflow({ [block.id]: block }, [], {}, {}, true)
      expect(serialized.blocks[0].config.params).toMatchObject({
        oauthCredential: 'ads-credential',
        customerId: '1234567890',
        query: 'SELECT campaign.id FROM campaign',
      })
      expect(serialized.blocks[0].config.params).not.toHaveProperty('developerToken')
    }
  )
})

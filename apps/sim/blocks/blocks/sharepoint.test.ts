import { triggersMock } from '@sim/testing/mocks/triggers.mock'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/triggers', () => triggersMock)

import { SharepointV2Block } from '@/blocks/blocks/sharepoint'

const mapParams = SharepointV2Block.tools.config?.params

describe('SharePoint v2 mapper on agent tool calls', () => {
  it('maps get list item select fields from the row or the model', () => {
    if (!mapParams) throw new Error('SharePoint v2 block has no params mapper')
    const operation = 'sharepoint_get_list_item'
    const target = { siteId: 'site', listId: 'list', itemId: '7' }

    expect(
      mapParams({ ...target, itemSelectFields: 'Title,Status' }, { operation }).selectFields
    ).toBe('Title,Status')
    expect(mapParams({ ...target, selectFields: 'Title' }, { operation }).selectFields).toBe(
      'Title'
    )
  })
})

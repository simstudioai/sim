import { describe, expect, it } from 'vitest'
import { HubSpotBlock } from '@/blocks/blocks/hubspot'

function mapParams(params: Record<string, unknown>, operation: string) {
  const mapper = HubSpotBlock.tools.config?.params
  if (!mapper) throw new Error('HubSpot block has no params mapper')
  return mapper(params, { operation })
}

describe('HubSpot create_list name on a tool call', () => {
  const list = { oauthCredential: 'cred-1', objectTypeId: '0-1', processingType: 'MANUAL' }

  it('keeps the List Name pinned on the tool row over the model name', () => {
    expect(
      mapParams({ ...list, listName: 'My List', name: 'Model Name' }, 'create_list').name
    ).toBe('My List')
  })

  it('uses the model name when the row leaves List Name empty', () => {
    expect(mapParams({ ...list, name: 'Model Name' }, 'create_list').name).toBe('Model Name')
  })
})

import { describe, expect, it } from 'vitest'
import { InstantlyV2Block } from '@/blocks/blocks/instantly'
import type { BlockToolParamsContext } from '@/blocks/types'

function mapParams(params: Record<string, unknown>, context?: BlockToolParamsContext) {
  const mapper = InstantlyV2Block.tools.config?.params
  if (!mapper) throw new Error('Instantly block has no params mapper')
  return { ...params, ...mapper(params, context) }
}

describe('Instantly agent tool calls', () => {
  it('keeps the model interest value so the update does not fail as missing', () => {
    const merged = mapParams(
      { lead_email: 'ann@example.com', interest_value: 1, campaign_id: 'camp-1' },
      { operation: 'update_lead_interest_status' }
    )

    expect(merged.interest_value).toBe(1)
    expect(merged.campaign_id).toBe('camp-1')
  })

  it('keeps model lead fields named by the tool instead of wiping them', () => {
    const merged = mapParams(
      { email: 'ann@example.com', first_name: 'Ann', campaign: 'camp-1', skip_if_in_list: true },
      { operation: 'create_lead' }
    )

    expect(merged).toMatchObject({ first_name: 'Ann', campaign: 'camp-1', skip_if_in_list: true })
  })

  it('keeps the model reply body when the block body fields are empty', () => {
    const merged = mapParams(
      { reply_to_uuid: 'email-1', eaccount: 'me@example.com', subject: 'Re', body: { text: 'Hi' } },
      { operation: 'reply_to_email' }
    )

    expect(merged.body).toEqual({ text: 'Hi' })
  })
})

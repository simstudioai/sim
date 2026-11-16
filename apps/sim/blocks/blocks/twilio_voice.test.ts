import { describe, expect, it } from 'vitest'
import { TwilioVoiceV2Block } from '@/blocks/blocks/twilio_voice'

const mapParams = TwilioVoiceV2Block.tools.config?.params
if (!mapParams) throw new Error('Twilio Voice block has no params mapper')

describe('Twilio Voice mapper on a tool call', () => {
  it("applies a List Calls row's stored filters, which the operation only names in context", () => {
    const result = mapParams(
      { credential: 'cred-1', listStatus: 'completed', listPageSize: '10', listTo: '+14155550100' },
      { operation: 'list_calls' }
    )

    expect(result).toMatchObject({ status: 'completed', pageSize: 10, to: '+14155550100' })
  })

  it("keeps the model's own filters when the row stores none", () => {
    const result = mapParams(
      { credential: 'cred-1', status: 'busy', to: '+14155550100', pageSize: 5 },
      { operation: 'list_calls' }
    )

    expect(result).toMatchObject({ status: 'busy', to: '+14155550100', pageSize: 5 })
  })
})

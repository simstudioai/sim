/**
 * An agent tool call passes the model's args under the tool's param names with the operation only
 * in the mapper context, and the mapper's result is spread over those args.
 */
import { describe, expect, it } from 'vitest'
import { SmartleadBlock } from '@/blocks/blocks/smartlead'
import { addLeadsToCampaignTool } from '@/tools/smartlead/add_leads_to_campaign'
import { getLeadByEmailTool } from '@/tools/smartlead/get_lead_by_email'

function agentToolParams(operation: string, args: Record<string, unknown>) {
  const mapped = SmartleadBlock.tools.config?.params?.(args, { operation }) ?? {}
  return { ...args, ...mapped } as never
}

describe('Smartlead agent tool calls', () => {
  it('adds the leads the model passes to the campaign', () => {
    const params = agentToolParams('add_leads_to_campaign', {
      apiKey: 'key',
      campaignId: 42,
      leads: [{ email: 'ada@example.com', first_name: 'Ada' }],
    })
    const body = addLeadsToCampaignTool.request.body?.(params) as { lead_list: unknown[] }
    expect(body.lead_list).toHaveLength(1)
    expect(body.lead_list[0]).toMatchObject({ email: 'ada@example.com' })
  })

  it('looks up the lead by the email the model passes', () => {
    const params = agentToolParams('get_lead_by_email', {
      apiKey: 'key',
      email: 'ada@example.com',
    })
    const url = new URL((getLeadByEmailTool.request.url as (p: never) => string)(params))
    expect(url.searchParams.get('email')).toBe('ada@example.com')
  })
})

/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { enrichCompanyTool } from '@/tools/datagma/enrich_company'
import { enrichPersonTool } from '@/tools/datagma/enrich_person'
import { findEmailTool } from '@/tools/datagma/find_email'
import { findPhoneTool } from '@/tools/datagma/find_phone'
import { getCreditsTool } from '@/tools/datagma/get_credits'
import { DATAGMA_CREDIT_USD } from '@/tools/datagma/hosting'
import type { ToolConfig } from '@/tools/types'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function cost(tool: ToolConfig<any, any>, params: any, output: Record<string, unknown>) {
  const pricing = tool.hosting?.pricing
  if (!pricing || pricing.type !== 'custom') throw new Error('Expected custom pricing')
  const result = pricing.getCost(params, output)
  return typeof result === 'number' ? { cost: result } : result
}

describe('Datagma hosted key config', () => {
  it('declares the shared env prefix and BYOK provider on all credit-consuming tools', () => {
    for (const tool of [findEmailTool, enrichPersonTool, enrichCompanyTool, findPhoneTool]) {
      expect(tool.hosting?.envKeyPrefix).toBe('DATAGMA_API_KEY')
      expect(tool.hosting?.byokProviderId).toBe('datagma')
    }
  })

  it('get_credits tool has no hosting config (always BYOK)', () => {
    expect(getCreditsTool.hosting).toBeUndefined()
  })
})

describe('Datagma find email pricing', () => {
  it('charges 1 credit when a verified email is found', () => {
    expect(cost(findEmailTool, {}, { email: 'john@stripe.com' }).cost).toBeCloseTo(
      DATAGMA_CREDIT_USD
    )
  })

  it('charges 0 credits when no email is returned', () => {
    expect(cost(findEmailTool, {}, { email: null }).cost).toBe(0)
    expect(cost(findEmailTool, {}, {}).cost).toBe(0)
  })
})

describe('Datagma enrich person pricing', () => {
  it('charges 2 credits on a match without phone', () => {
    expect(
      cost(enrichPersonTool, {}, { name: 'John Doe', email: 'john@stripe.com', phone: null }).cost
    ).toBeCloseTo(2 * DATAGMA_CREDIT_USD)
  })

  it('charges 32 credits (2 + 30) when a phone lookup was requested and found', () => {
    expect(
      cost(
        enrichPersonTool,
        { phoneFull: true },
        { name: 'John Doe', email: 'john@stripe.com', phone: '+14155551234' }
      ).cost
    ).toBeCloseTo(32 * DATAGMA_CREDIT_USD)
  })

  it('does not charge the phone surcharge when phoneFull was not requested', () => {
    expect(
      cost(
        enrichPersonTool,
        {},
        { name: 'John Doe', email: 'john@stripe.com', phone: '+14155551234' }
      ).cost
    ).toBeCloseTo(2 * DATAGMA_CREDIT_USD)
  })

  it('charges 0 credits on no match', () => {
    expect(cost(enrichPersonTool, {}, { name: null, email: null }).cost).toBe(0)
    expect(cost(enrichPersonTool, {}, {}).cost).toBe(0)
  })
})

describe('Datagma enrich company pricing', () => {
  it('charges 2 credits on a match', () => {
    expect(cost(enrichCompanyTool, {}, { name: 'Stripe', website: 'stripe.com' }).cost).toBeCloseTo(
      2 * DATAGMA_CREDIT_USD
    )
  })

  it('charges 2 credits when only website is present', () => {
    expect(cost(enrichCompanyTool, {}, { name: null, website: 'stripe.com' }).cost).toBeCloseTo(
      2 * DATAGMA_CREDIT_USD
    )
  })

  it('charges 0 credits on no match', () => {
    expect(cost(enrichCompanyTool, {}, { name: null, website: null }).cost).toBe(0)
    expect(cost(enrichCompanyTool, {}, {}).cost).toBe(0)
  })
})

describe('Datagma find phone pricing', () => {
  it('charges 30 credits when a phone number is found', () => {
    expect(cost(findPhoneTool, {}, { phone: '+14155551234' }).cost).toBeCloseTo(
      30 * DATAGMA_CREDIT_USD
    )
  })

  it('charges 0 credits when no phone is returned', () => {
    expect(cost(findPhoneTool, {}, { phone: null }).cost).toBe(0)
    expect(cost(findPhoneTool, {}, {}).cost).toBe(0)
  })
})

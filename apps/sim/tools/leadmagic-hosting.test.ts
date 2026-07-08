/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { companySearchTool } from '@/tools/leadmagic/company_search'
import { emailToProfileTool } from '@/tools/leadmagic/email_to_profile'
import { findEmailTool } from '@/tools/leadmagic/find_email'
import { findMobileTool } from '@/tools/leadmagic/find_mobile'
import { getCreditsTool } from '@/tools/leadmagic/get_credits'
import { LEADMAGIC_CREDIT_USD } from '@/tools/leadmagic/hosting'
import { profileSearchTool } from '@/tools/leadmagic/profile_search'
import { profileToEmailTool } from '@/tools/leadmagic/profile_to_email'
import { roleFinderTool } from '@/tools/leadmagic/role_finder'
import { validateEmailTool } from '@/tools/leadmagic/validate_email'
import type { ToolConfig } from '@/tools/types'

function cost(tool: ToolConfig<any, any>, params: any, output: Record<string, unknown>) {
  const pricing = tool.hosting?.pricing
  if (!pricing || pricing.type !== 'custom') throw new Error('Expected custom pricing')
  const result = pricing.getCost(params, output)
  return typeof result === 'number' ? { cost: result } : result
}

describe('LeadMagic hosted key config', () => {
  it('declares the correct env prefix and BYOK provider for all credit-consuming tools', () => {
    const tools = [
      validateEmailTool,
      findEmailTool,
      findMobileTool,
      profileSearchTool,
      profileToEmailTool,
      emailToProfileTool,
      companySearchTool,
      roleFinderTool,
    ]
    for (const tool of tools) {
      expect(tool.hosting?.envKeyPrefix).toBe('LEADMAGIC_API_KEY')
      expect(tool.hosting?.byokProviderId).toBe('leadmagic')
    }
  })

  it('get_credits has no hosting config (free endpoint)', () => {
    expect(getCreditsTool.hosting).toBeUndefined()
  })
})

describe('LeadMagic hosted key pricing', () => {
  it('validate_email: uses API-reported credits_consumed', () => {
    expect(cost(validateEmailTool, {}, { credits_consumed: 0.25 }).cost).toBeCloseTo(
      0.25 * LEADMAGIC_CREDIT_USD
    )
    expect(cost(validateEmailTool, {}, { credits_consumed: 0 }).cost).toBe(0)
  })

  it('find_email: 1 credit when email found, 0 otherwise', () => {
    expect(cost(findEmailTool, {}, { credits_consumed: 1 }).cost).toBeCloseTo(LEADMAGIC_CREDIT_USD)
    expect(cost(findEmailTool, {}, { credits_consumed: 0, email: null }).cost).toBe(0)
    // fallback path when credits_consumed missing
    expect(cost(findEmailTool, {}, { email: 'a@b.com' }).cost).toBeCloseTo(LEADMAGIC_CREDIT_USD)
    expect(cost(findEmailTool, {}, { email: null }).cost).toBe(0)
  })

  it('find_mobile: 5 credits when mobile found, 0 otherwise', () => {
    expect(cost(findMobileTool, {}, { credits_consumed: 5 }).cost).toBeCloseTo(
      5 * LEADMAGIC_CREDIT_USD
    )
    expect(cost(findMobileTool, {}, { credits_consumed: 0 }).cost).toBe(0)
    // fallback path
    expect(cost(findMobileTool, {}, { mobile_number: '+15551234567' }).cost).toBeCloseTo(
      5 * LEADMAGIC_CREDIT_USD
    )
    expect(cost(findMobileTool, {}, { mobile_number: null }).cost).toBe(0)
  })

  it('profile_search: 1 credit when profile found, 0 otherwise', () => {
    expect(cost(profileSearchTool, {}, { credits_consumed: 1 }).cost).toBeCloseTo(
      LEADMAGIC_CREDIT_USD
    )
    expect(cost(profileSearchTool, {}, { credits_consumed: 0 }).cost).toBe(0)
  })

  it('profile_to_email: 5 credits when email found, 0 otherwise', () => {
    expect(cost(profileToEmailTool, {}, { credits_consumed: 5 }).cost).toBeCloseTo(
      5 * LEADMAGIC_CREDIT_USD
    )
    expect(cost(profileToEmailTool, {}, { credits_consumed: 0 }).cost).toBe(0)
    // fallback path
    expect(cost(profileToEmailTool, {}, { email: 'a@b.com' }).cost).toBeCloseTo(
      5 * LEADMAGIC_CREDIT_USD
    )
    expect(cost(profileToEmailTool, {}, { email: null }).cost).toBe(0)
  })

  it('email_to_profile: 10 credits when profile found, 0 otherwise', () => {
    expect(cost(emailToProfileTool, {}, { credits_consumed: 10 }).cost).toBeCloseTo(
      10 * LEADMAGIC_CREDIT_USD
    )
    expect(cost(emailToProfileTool, {}, { credits_consumed: 0 }).cost).toBe(0)
    // fallback path
    expect(
      cost(emailToProfileTool, {}, { profile_url: 'https://linkedin.com/in/johndoe' }).cost
    ).toBeCloseTo(10 * LEADMAGIC_CREDIT_USD)
    expect(cost(emailToProfileTool, {}, { profile_url: null }).cost).toBe(0)
  })

  it('company_search: 1 credit when company found, 0 otherwise', () => {
    expect(cost(companySearchTool, {}, { credits_consumed: 1 }).cost).toBeCloseTo(
      LEADMAGIC_CREDIT_USD
    )
    expect(cost(companySearchTool, {}, { credits_consumed: 0 }).cost).toBe(0)
    // fallback path
    expect(cost(companySearchTool, {}, { companyName: 'Stripe' }).cost).toBeCloseTo(
      LEADMAGIC_CREDIT_USD
    )
    expect(cost(companySearchTool, {}, { companyName: null }).cost).toBe(0)
  })

  it('role_finder: 2 credits when person found, 0 otherwise', () => {
    expect(cost(roleFinderTool, {}, { credits_consumed: 2 }).cost).toBeCloseTo(
      2 * LEADMAGIC_CREDIT_USD
    )
    expect(cost(roleFinderTool, {}, { credits_consumed: 0 }).cost).toBe(0)
    // fallback path
    expect(cost(roleFinderTool, {}, { full_name: 'John Doe' }).cost).toBeCloseTo(
      2 * LEADMAGIC_CREDIT_USD
    )
    expect(cost(roleFinderTool, {}, { full_name: null }).cost).toBe(0)
  })
})

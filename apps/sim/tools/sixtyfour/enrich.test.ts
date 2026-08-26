/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { SixtyfourBlock } from '@/blocks/blocks/sixtyfour'
import { sixtyfourEnrichCompanyTool } from '@/tools/sixtyfour/enrich_company'
import { sixtyfourEnrichLeadTool } from '@/tools/sixtyfour/enrich_lead'
import { SIXTYFOUR_ENRICH_TIMEOUT_MS } from '@/tools/sixtyfour/types'

const LEAD_INFO = '{"name":"John Doe","company":"Acme"}'

function leadBody(params: Record<string, unknown>): Record<string, unknown> {
  return sixtyfourEnrichLeadTool.request.body!({
    apiKey: 'k',
    leadInfo: LEAD_INFO,
    ...params,
  } as never) as Record<string, unknown>
}

function companyBody(params: Record<string, unknown>): Record<string, unknown> {
  return sixtyfourEnrichCompanyTool.request.body!({
    apiKey: 'k',
    targetCompany: '{"name":"Acme"}',
    struct: '{"website":"Company website"}',
    ...params,
  } as never) as Record<string, unknown>
}

const mapBlockParams = SixtyfourBlock.tools.config!.params!

describe('sixtyfour enrichment struct requirement', () => {
  it('does not require struct on the lead path — EnrichLeadInfo requires lead_info only', () => {
    expect(sixtyfourEnrichLeadTool.params.struct.required).toBe(false)
    const body = leadBody({})
    expect(body.lead_info).toEqual({ name: 'John Doe', company: 'Acme' })
    expect('struct' in body).toBe(false)
  })

  it('still sends struct on the lead path when the caller supplies it', () => {
    const body = leadBody({ struct: '{"email":"Email address"}' })
    expect(body.struct).toEqual({ email: 'Email address' })
  })

  it('keeps struct required on the company path — EnrichCompanyInfo requires it', () => {
    expect(sixtyfourEnrichCompanyTool.params.struct.required).toBe(true)
  })

  it('leaves the block Fields to Collect field optional for enrich_lead', () => {
    const leadStruct = SixtyfourBlock.subBlocks.find((sb) => sb.id === 'leadStruct')
    expect(leadStruct?.required).toBeUndefined()
    const companyStruct = SixtyfourBlock.subBlocks.find((sb) => sb.id === 'companyStruct')
    expect(companyStruct?.required).toEqual({ field: 'operation', value: 'enrich_company' })
  })
})

describe('sixtyfour enrichment timeout', () => {
  it('sends a 15-minute deadline for enrich_lead instead of the 300000 ms default', () => {
    expect(SIXTYFOUR_ENRICH_TIMEOUT_MS).toBe(900_000)
    const mapped = mapBlockParams({ operation: 'enrich_lead', leadInfo: LEAD_INFO })
    expect(mapped.timeout).toBe(SIXTYFOUR_ENRICH_TIMEOUT_MS)
  })

  it('sends the same deadline for enrich_company', () => {
    const mapped = mapBlockParams({ operation: 'enrich_company', targetCompany: '{}' })
    expect(mapped.timeout).toBe(SIXTYFOUR_ENRICH_TIMEOUT_MS)
  })

  it('leaves the short find_* operations on the platform default', () => {
    expect(mapBlockParams({ operation: 'find_email' }).timeout).toBeUndefined()
    expect(mapBlockParams({ operation: 'find_phone' }).timeout).toBeUndefined()
  })
})

describe('sixtyfour research tier', () => {
  it('omits tier entirely when unset so Sixtyfour applies its own low default', () => {
    expect('tier' in leadBody({})).toBe(false)
    expect('tier' in companyBody({})).toBe(false)
  })

  it('forwards tier on both endpoints', () => {
    expect(leadBody({ tier: 'xhigh' }).tier).toBe('xhigh')
    expect(companyBody({ tier: 'micro' }).tier).toBe('micro')
  })

  it('exposes the per-operation enum, and never the unpriced scout tier', () => {
    const leadTier = SixtyfourBlock.subBlocks.find((sb) => sb.id === 'leadTier')
    const companyTier = SixtyfourBlock.subBlocks.find((sb) => sb.id === 'companyTier')
    expect((leadTier?.options as { id: string }[]).map((o) => o.id)).toEqual([
      'micro',
      'low',
      'medium',
      'high',
      'xhigh',
    ])
    expect((companyTier?.options as { id: string }[]).map((o) => o.id)).toEqual([
      'micro',
      'low',
      'medium',
      'high',
    ])
  })

  it('maps the per-operation block field onto the shared tool param', () => {
    expect(mapBlockParams({ operation: 'enrich_lead', leadTier: 'high' }).tier).toBe('high')
    expect(mapBlockParams({ operation: 'enrich_company', companyTier: 'medium' }).tier).toBe(
      'medium'
    )
  })
})

describe('sixtyfour block param mapping preserves LLM-supplied values', () => {
  it('does not null an LLM-supplied struct on the company path', () => {
    const mapped = mapBlockParams({ operation: 'enrich_company' })
    expect('struct' in mapped).toBe(false)
  })

  it('does not null an LLM-supplied targetCompany on the company path', () => {
    const mapped = mapBlockParams({ operation: 'enrich_company' })
    expect('targetCompany' in mapped).toBe(false)
  })

  it('does not null an LLM-supplied leadInfo on the lead path', () => {
    const mapped = mapBlockParams({ operation: 'enrich_lead' })
    expect('leadInfo' in mapped).toBe(false)
  })

  it('still maps the company subBlock values when the user supplies them', () => {
    const mapped = mapBlockParams({
      operation: 'enrich_company',
      targetCompany: '{"name":"Acme"}',
      companyStruct: '{"website":"Company website"}',
    })
    expect(mapped.targetCompany).toBe('{"name":"Acme"}')
    expect(mapped.struct).toBe('{"website":"Company website"}')
  })
})

describe('sixtyfour struct descriptions match the documented behavior', () => {
  it('does not claim Sixtyfour picks fields when struct is omitted', () => {
    const description = sixtyfourEnrichLeadTool.params.struct.description ?? ''
    expect(description).not.toMatch(/choose the fields/i)
    expect(description).toMatch(/structured_data/)
  })
})

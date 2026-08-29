/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { SixtyfourBlock } from '@/blocks/blocks/sixtyfour'
import { transformBlockTool } from '@/providers/utils'
import { sixtyfourEnrichCompanyTool } from '@/tools/sixtyfour/enrich_company'
import { sixtyfourEnrichLeadTool } from '@/tools/sixtyfour/enrich_lead'
import { sixtyfourFindEmailTool } from '@/tools/sixtyfour/find_email'
import { sixtyfourFindPhoneTool } from '@/tools/sixtyfour/find_phone'
import type { ExecutableToolConfig } from '@/tools/types'

const SIXTYFOUR_TOOLS: Record<string, ExecutableToolConfig> = {
  sixtyfour_find_phone: sixtyfourFindPhoneTool as ExecutableToolConfig,
  sixtyfour_find_email: sixtyfourFindEmailTool as ExecutableToolConfig,
  sixtyfour_enrich_lead: sixtyfourEnrichLeadTool as ExecutableToolConfig,
  sixtyfour_enrich_company: sixtyfourEnrichCompanyTool as ExecutableToolConfig,
}

const buildParams = SixtyfourBlock.tools.config!.params!

/** The shape the generic (canvas) handler forwards: raw inputs overlaid by the mapper. */
const resolve = (inputs: Record<string, unknown>) => ({ ...inputs, ...buildParams(inputs) })

/**
 * Builds the agent-path `paramsTransform` the way `transformBlockTool` does, so
 * assertions run against the exact function that rewrites a model's tool-call
 * arguments before `executeTool` sees them.
 */
async function agentParamsTransform(
  operation: string,
  blockParams: Record<string, unknown>
): Promise<(args: Record<string, unknown>) => Record<string, unknown>> {
  const tool = await transformBlockTool(
    { type: 'sixtyfour', operation, params: { operation, ...blockParams } },
    {
      selectedOperation: operation,
      getAllBlocks: () => [SixtyfourBlock],
      getTool: (id: string) => SIXTYFOUR_TOOLS[id],
    }
  )
  if (!tool?.paramsTransform) throw new Error(`No paramsTransform for ${operation}`)
  return tool.paramsTransform as (args: Record<string, unknown>) => Record<string, unknown>
}

describe('SixtyfourBlock agent path', () => {
  it('keeps the model-supplied struct for enrich_lead', async () => {
    const transform = await agentParamsTransform('enrich_lead', { apiKey: 'key' })

    const sent = transform({
      operation: 'enrich_lead',
      apiKey: 'key',
      leadInfo: '{"name":"John Doe"}',
      struct: '{"email":"Work email address"}',
    })

    expect(sent.struct).toBe('{"email":"Work email address"}')
    expect(sent.leadInfo).toBe('{"name":"John Doe"}')
  })

  it('keeps the model-supplied struct for enrich_company', async () => {
    const transform = await agentParamsTransform('enrich_company', { apiKey: 'key' })

    const sent = transform({
      operation: 'enrich_company',
      apiKey: 'key',
      targetCompany: '{"name":"Acme Inc"}',
      struct: '{"website":"Company website URL"}',
    })

    expect(sent.struct).toBe('{"website":"Company website URL"}')
    expect(sent.targetCompany).toBe('{"name":"Acme Inc"}')
  })

  it('lets a configured block value win over the model for enrich_lead', async () => {
    const transform = await agentParamsTransform('enrich_lead', {
      apiKey: 'key',
      leadStruct: '{"phone":"Phone number"}',
    })

    const sent = transform({
      operation: 'enrich_lead',
      apiKey: 'key',
      leadStruct: '{"phone":"Phone number"}',
      leadInfo: '{"name":"John Doe"}',
    })

    expect(sent.struct).toBe('{"phone":"Phone number"}')
  })
})

describe('SixtyfourBlock canvas path', () => {
  it('maps the lead subBlocks onto the tool params', () => {
    const params = resolve({
      operation: 'enrich_lead',
      apiKey: 'key',
      leadInfo: '{"name":"John Doe"}',
      leadStruct: '{"email":"Work email address"}',
      leadResearchPlan: 'Check LinkedIn first',
    })

    expect(params.leadInfo).toBe('{"name":"John Doe"}')
    expect(params.struct).toBe('{"email":"Work email address"}')
    expect(params.researchPlan).toBe('Check LinkedIn first')
  })

  it('maps the company subBlocks onto the tool params', () => {
    const params = resolve({
      operation: 'enrich_company',
      apiKey: 'key',
      targetCompany: '{"name":"Acme Inc"}',
      companyStruct: '{"website":"Company website URL"}',
      companyLeadStruct: '{"name":"Full name"}',
      companyResearchPlan: 'Start from the careers page',
    })

    expect(params.targetCompany).toBe('{"name":"Acme Inc"}')
    expect(params.struct).toBe('{"website":"Company website URL"}')
    expect(params.leadStruct).toBe('{"name":"Full name"}')
    expect(params.researchPlan).toBe('Start from the careers page')
  })

  it('renames the lookup inputs for the find operations', () => {
    expect(resolve({ operation: 'find_phone', emailInput: 'a@b.com' }).email).toBe('a@b.com')
    expect(resolve({ operation: 'find_email', phoneInput: '+15551234' }).phone).toBe('+15551234')
  })
})

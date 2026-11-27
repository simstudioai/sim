/**
 * Workflow runs merge raw subBlock inputs under mapped params, so the Dealport mapper must
 * clear fields left behind by other operations. Agent tool calls pass the operation in
 * `context` and supply arguments under tool parameter names, which the mapper must preserve.
 */
import { describe, expect, it } from 'vitest'
import { DealportBlock } from '@/blocks/blocks/dealport'
import { dealportFindOwnerTool } from '@/tools/dealport/find_owner'
import { dealportPreviewCompaniesTool } from '@/tools/dealport/preview_companies'
import { dealportSearchBuildingsTool } from '@/tools/dealport/search_buildings'
import type { ToolConfig } from '@/tools/types'

const CREDENTIAL = { oauthCredential: 'cred-dealport-1', accessToken: 'dp_live_test_token' }

function requestBody(tool: ToolConfig, params: Record<string, unknown>) {
  const body = tool.request.body
  if (typeof body !== 'function') throw new Error(`${tool.id} has no request body`)
  return body(params)
}

function requestUrl(tool: ToolConfig, params: Record<string, unknown>) {
  const url = tool.request.url
  return typeof url === 'function' ? url(params) : url
}

function workflowParams(inputs: Record<string, unknown>): Record<string, unknown> {
  const mapped = DealportBlock.tools.config?.params?.(inputs) ?? {}
  return { ...inputs, ...mapped, accessToken: CREDENTIAL.accessToken }
}

function agentParams(operation: string, args: Record<string, unknown>): Record<string, unknown> {
  const inputs = { ...CREDENTIAL, ...args }
  const mapped = DealportBlock.tools.config?.params?.(inputs, { operation }) ?? {}
  return { ...inputs, ...mapped, accessToken: CREDENTIAL.accessToken }
}

describe('Dealport block parameter mapping', () => {
  it('clears company search state and query fields when switching to other operations', () => {
    const ownerParams = workflowParams({
      ...CREDENTIAL,
      operation: 'dealport_find_owner',
      state: 'OH',
      llc_name: 'Tanforan Holdings LLC',
      ownerState: '',
    })
    expect(requestBody(dealportFindOwnerTool, ownerParams)).toEqual({
      llc_name: 'Tanforan Holdings LLC',
    })

    const buildingParams = workflowParams({
      ...CREDENTIAL,
      operation: 'dealport_search_buildings',
      q: 'Buckeye Mechanical',
      borough: 'BK',
      buildingQuery: 'Atlantic Ave',
    })
    expect(requestUrl(dealportSearchBuildingsTool, buildingParams)).toBe(
      'https://app.dealport.com/api/v1/buildings?borough=BK&q=Atlantic+Ave'
    )
  })

  it('coerces numeric and boolean inputs at execution time and rejects non-numeric strings', () => {
    const previewParams = workflowParams({
      ...CREDENTIAL,
      operation: 'dealport_preview_companies',
      state: 'oh',
      naics: '238220, 332710',
      min_employees: '15',
      independent: 'true',
    })
    expect(requestBody(dealportPreviewCompaniesTool, previewParams)).toEqual({
      state: 'OH',
      naics: ['238220', '332710'],
      min_employees: 15,
      independent: true,
    })

    expect(() =>
      workflowParams({
        ...CREDENTIAL,
        operation: 'dealport_preview_companies',
        min_revenue: 'not-a-number',
      })
    ).toThrow('min_revenue must be a number')
  })

  it('preserves agent tool-call arguments supplied under tool parameter names', () => {
    const ownerParams = agentParams('dealport_find_owner', {
      llc_name: 'Tanforan Holdings LLC',
      state: 'ca',
      city: 'San Bruno',
    })
    expect(requestBody(dealportFindOwnerTool, ownerParams)).toEqual({
      llc_name: 'Tanforan Holdings LLC',
      state: 'CA',
      city: 'San Bruno',
    })

    const buildingParams = agentParams('dealport_search_buildings', {
      borough: 'mn',
      q: 'Broadway',
      min_units: 20,
    })
    expect(requestUrl(dealportSearchBuildingsTool, buildingParams)).toBe(
      'https://app.dealport.com/api/v1/buildings?borough=MN&min_units=20&q=Broadway'
    )
  })
})

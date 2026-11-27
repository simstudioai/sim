/**
 * Verifies Dealport request boundary invariants: mutually exclusive match inputs, batch size
 * bounds, owner target presence, path-segment traversal rejection on Record lookups, and
 * response normalization across all six Dealport V4 endpoints.
 */
import { describe, expect, it } from 'vitest'
import { dealportFindOwnerTool } from '@/tools/dealport/find_owner'
import { dealportGetRecordTool } from '@/tools/dealport/get_record'
import { dealportMatchCompaniesTool } from '@/tools/dealport/match_companies'
import { dealportPreviewCompaniesTool } from '@/tools/dealport/preview_companies'
import { dealportSearchBuildingsTool } from '@/tools/dealport/search_buildings'
import { dealportSearchCompaniesTool } from '@/tools/dealport/search_companies'
import type { ToolConfig, ToolResponse } from '@/tools/types'

function requestBody(tool: ToolConfig, params: Record<string, unknown>) {
  const body = tool.request.body
  if (typeof body !== 'function') throw new Error(`${tool.id} has no request body`)
  return body({ accessToken: 'dp_live_test_token', ...params })
}

function requestUrl(tool: ToolConfig, params: Record<string, unknown>) {
  const url = tool.request.url
  if (typeof url !== 'function') return url
  return url({ accessToken: 'dp_live_test_token', ...params })
}

async function transform<P, R extends ToolResponse>(
  tool: ToolConfig<P, R>,
  payload: Record<string, unknown>
): Promise<R> {
  if (!tool.transformResponse) throw new Error(`${tool.id} has no transformResponse`)
  return tool.transformResponse(new Response(JSON.stringify(payload)))
}

describe('Dealport request validation', () => {
  it('enforces mutually exclusive items vs csv and 1..250 row bounds on match_companies', () => {
    expect(() => requestBody(dealportMatchCompaniesTool, {})).toThrow(
      'Provide either items (JSON array) or csv (CSV text) to match companies'
    )

    expect(() =>
      requestBody(dealportMatchCompaniesTool, {
        items: [{ name: 'Buckeye Mechanical' }],
        csv: 'name\nBuckeye Mechanical',
      })
    ).toThrow('Provide either items or csv, not both')

    expect(() => requestBody(dealportMatchCompaniesTool, { items: [] })).toThrow(
      'items must contain between 1 and 250 company objects'
    )

    const tooMany = Array.from({ length: 251 }, (_, i) => ({ name: `Company ${i}` }))
    expect(() => requestBody(dealportMatchCompaniesTool, { items: tooMany })).toThrow(
      'items must contain between 1 and 250 company objects'
    )

    expect(
      requestBody(dealportMatchCompaniesTool, {
        items:
          '[{"name":" Buckeye Mechanical ","domain":"buckeyemechanical.example","state":"OH"}]',
        project_name: 'Ohio Targets',
      })
    ).toEqual({
      items: [
        {
          name: 'Buckeye Mechanical',
          domain: 'buckeyemechanical.example',
          state: 'OH',
        },
      ],
      project_name: 'Ohio Targets',
    })
  })

  it('requires at least one target identifier on find_owner', () => {
    expect(() => requestBody(dealportFindOwnerTool, { state: 'OH' })).toThrow(
      'Provide at least one of company_id, llc_name, or property_address'
    )

    expect(
      requestBody(dealportFindOwnerTool, {
        company_id: ' 00000000-0000-4000-8000-000000000001 ',
        person: ' Jane Miller ',
      })
    ).toEqual({
      company_id: '00000000-0000-4000-8000-000000000001',
      person: 'Jane Miller',
    })
  })

  it('rejects traversal segments on get_record and blank boroughs on search_buildings', () => {
    expect(() => requestUrl(dealportGetRecordTool, { recordId: '..' })).toThrow()
    expect(() => requestUrl(dealportGetRecordTool, { recordId: 'a/b' })).toThrow()
    expect(requestUrl(dealportGetRecordTool, { recordId: '1008350041' })).toBe(
      'https://app.dealport.com/api/v1/records/1008350041'
    )

    expect(() => requestUrl(dealportSearchBuildingsTool, { borough: '   ' })).toThrow(
      'borough is required'
    )
  })
})

describe('Dealport response transformations', () => {
  it('normalizes preview, search, building, Record, match, and owner responses', async () => {
    const previewOut = await transform(dealportPreviewCompaniesTool, {
      matching_count: 912,
      matching_count_more: false,
      sample: [
        {
          id: '00000000-0000-4000-8000-000000000001',
          name: 'Buckeye Mechanical Contracting',
          city: 'Columbus',
          state: 'OH',
          industry: 'Plumbing, Heating, and Air-Conditioning Contractors',
          employee_band: '25-49',
          revenue_band: '$5M-$10M',
          independent: true,
        },
      ],
      cost_usd: 0,
      remaining_balance_usd: 5,
      board_url: 'https://app.dealport.com/companies?state=OH',
    })
    expect(previewOut.output.matching_count).toBe(912)
    expect(previewOut.output.sample).toHaveLength(1)

    const companiesOut = await transform(dealportSearchCompaniesTool, {
      data: [
        {
          id: '00000000-0000-4000-8000-000000000001',
          name: 'Buckeye Mechanical Contracting',
          city: 'Columbus',
          state: 'OH',
          naics: ['238220'],
          industry: ['HVAC'],
          revenue: { value: null, low: 5000000, high: 10000000, basis: 'estimate' },
          employees: { value: 32, low: null, high: null, basis: 'filed' },
          owner: { name: 'Jane Miller', role: 'President' },
          sources: 4,
        },
      ],
      next_cursor: '25',
    })
    expect(companiesOut.output.companies[0]?.owner?.name).toBe('Jane Miller')
    expect(companiesOut.output.next_cursor).toBe('25')

    const buildingsOut = await transform(dealportSearchBuildingsTool, {
      data: [
        {
          bbl: '3012340056',
          borough: 'BK',
          address: '123 Atlantic Ave',
          owner_of_record: 'Atlantic Holdings LLC',
          residential_units: 24,
          loan: { holder_type: 'bank', estimated_due_year: 2027 },
        },
      ],
      next_cursor: null,
    })
    expect(buildingsOut.output.buildings[0]?.loan?.estimated_due_year).toBe(2027)

    const recordOut = await transform(dealportGetRecordTool, {
      data: {
        id: '00000000-0000-4000-8000-000000000001',
        kind: 'company',
        name: 'Buckeye Mechanical Contracting',
        summary: 'Commercial HVAC contractor in Columbus, OH.',
        facts: [
          {
            kind: 'employees',
            value: 32,
            basis: 'filed',
            source: { name: 'Ohio Secretary of State' },
          },
        ],
        people: [{ name: 'Jane Miller', role: 'President', owner: true, sources: ['OH SOS'] }],
        identifiers: [{ type: 'oh_entity_number', values: ['1234567'] }],
        sources: [{ name: 'Ohio Secretary of State', url: null }],
      },
      record_url: 'https://app.dealport.com/records/00000000-0000-4000-8000-000000000001',
      cost_usd: 0.01,
      remaining_balance_usd: 4.99,
    })
    expect(recordOut.output.record.facts[0]?.basis).toBe('filed')

    const matchOut = await transform(dealportMatchCompaniesTool, {
      data: {
        total_input: 1,
        matched_count: 1,
        unmatched_count: 0,
        domain_matched_count: 1,
        fuzzy_matched_count: 0,
        cached_owners_count: 0,
        matched_company_ids: ['00000000-0000-4000-8000-000000000001'],
        results: [
          {
            index: 0,
            input: { name: 'Buckeye Mechanical', domain: 'buckeyemechanical.example' },
            matched: true,
            match_method: 'domain_exact',
            company_id: '00000000-0000-4000-8000-000000000001',
            company_name: 'Buckeye Mechanical Contracting',
            naics: ['238220'],
          },
        ],
      },
      cost_usd: 0,
      remaining_balance_usd: 4.99,
    })
    expect(matchOut.output.matched_count).toBe(1)
    expect(matchOut.output.results[0]?.match_method).toBe('domain_exact')

    const ownerOut = await transform(dealportFindOwnerTool, {
      company: {
        id: '00000000-0000-4000-8000-000000000001',
        name: 'Buckeye Mechanical Contracting',
      },
      person: { name: 'Jane Miller', role: 'President' },
      phone: '+16145550100',
      email: 'jane@buckeyemechanical.example',
      phones: [{ number: '+16145550100', kind: 'mobile' }],
      emails: [{ address: 'jane@buckeyemechanical.example', kind: 'work', verified: true }],
      profile: { headline: 'President at Buckeye Mechanical', skills: ['HVAC'] },
      sources: [{ url: 'https://sos.state.oh.us', title: 'Ohio SOS' }],
      record_url: 'https://app.dealport.com/records/00000000-0000-4000-8000-000000000001',
      cost_usd: 0.09,
      remaining_balance_usd: 4.9,
    })
    expect(ownerOut.output.person?.name).toBe('Jane Miller')
    expect(ownerOut.output.phones[0]?.kind).toBe('mobile')
  })
})

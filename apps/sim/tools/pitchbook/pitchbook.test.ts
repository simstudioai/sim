/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

/**
 * Only this service's configs are needed; the full registry is ~6,000 modules.
 * Registration is asserted through the generated `@/tools/tool-ids`.
 */
vi.mock('@/tools/registry', async () => {
  const { partialToolRegistry } = await import('@sim/testing/mocks/tool-registry.mock')
  return { tools: partialToolRegistry(await import('@/tools/pitchbook')) }
})

import { PitchBookBlock } from '@/blocks/blocks/pitchbook'
import { ErrorExtractorId, extractErrorMessage, redactErrorData } from '@/tools/error-extractors'
import { executeTool } from '@/tools/index'
import RECORDED from '@/tools/pitchbook/__fixtures__/recorded-responses.json'
import { tools } from '@/tools/registry'
import { hasToolId } from '@/tools/tool-ids'

/**
 * The registry is typed `Record<string, ToolConfig>`, so a tool's `url`/`headers`/
 * `body` builders widen to their union. These narrow one back to a callable and
 * accept the caller's param object, keeping the assertions type-checked without
 * an `any` cast at every call site.
 */
type ToolParams = Record<string, unknown>

function urlBuilder(toolId: string): (params: ToolParams) => string {
  const url = tools[toolId].request.url
  if (typeof url !== 'function') throw new Error(`${toolId} has a static url`)
  return url as (params: ToolParams) => string
}

function headerBuilder(toolId: string): (params: ToolParams) => Record<string, string> {
  const headers = tools[toolId].request.headers
  if (typeof headers !== 'function') throw new Error(`${toolId} has no header builder`)
  return headers as (params: ToolParams) => Record<string, string>
}

function bodyBuilder(toolId: string): (params: ToolParams) => unknown {
  const body = tools[toolId].request.body
  if (typeof body !== 'function') throw new Error(`${toolId} has no body builder`)
  return body as (params: ToolParams) => unknown
}

function blockParams(input: ToolParams): Record<string, unknown> {
  const build = PitchBookBlock.tools.config?.params
  if (!build) throw new Error('PitchBook block declares no params mapper')
  return build(input) as Record<string, unknown>
}

describe('pitchbook wiring', () => {
  const access = PitchBookBlock.tools.access ?? []

  it('registry keys match each tool id', () => {
    for (const id of access) {
      expect(hasToolId(id), `missing registry entry ${id}`).toBe(true)
      expect(tools[id].id).toBe(id)
    }
  })

  it('every operation option maps to an accessible tool', () => {
    const op = PitchBookBlock.subBlocks.find((s) => s.id === 'operation')
    const ids = (op?.options as Array<{ id: string }>).map((o) => o.id)
    expect(ids.length).toBe(access.length)
    for (const id of ids) {
      const selected = PitchBookBlock.tools.config?.tool?.({ operation: id })
      expect(access).toContain(selected)
    }
  })

  it('subblock ids are unique', () => {
    const ids = PitchBookBlock.subBlocks.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('maps prefixed search subblocks onto PitchBook query params', () => {
    const mapped = blockParams({
      operation: 'company_search',
      apiKey: 'k',
      coNames: 'Databricks',
      coCountry: 'USA',
      coDealDate: '>2023-01-01',
      page: '2',
      perPage: '50',
      additionalFilters: '{"locationType":"HQ_ONLY"}',
    })

    expect(mapped.companyNames).toBe('Databricks')
    expect(mapped.country).toBe('USA')
    expect(mapped.dealDate).toBe('>2023-01-01')
    expect(mapped.coNames).toBeUndefined()
    expect(mapped.page).toBe(2)
    expect(mapped.perPage).toBe(50)
    expect(mapped.additionalFilters).toEqual({ locationType: 'HQ_ONLY' })
  })

  it('collapses the entity-specific id subblock onto pbId', () => {
    const mapped = blockParams({
      operation: 'company_bio',
      apiKey: 'k',
      companyId: '10618-03',
    })
    expect(mapped.pbId).toBe('10618-03')
    expect(mapped.companyId).toBeUndefined()
  })

  it('builds a company search URL with filters, paging, and extras', () => {
    const url = urlBuilder('pitchbook_company_search')
    const built = url({
      apiKey: 'k',
      companyNames: 'Databricks',
      dealDate: '>2023-01-01',
      country: '',
      page: 2,
      perPage: 50,
      additionalFilters: { locationType: 'HQ_ONLY' },
    })
    expect(built).toContain('https://api.pitchbook.com/companies/search?')
    expect(built).toContain('companyNames=Databricks')
    expect(built).toContain('dealDate=%3E2023-01-01')
    expect(built).toContain('locationType=HQ_ONLY')
    expect(built).toContain('page=2')
    expect(built).toContain('perPage=50')
    expect(built).not.toContain('country=')
  })

  it('sends the PB-Token auth header and X-Currency only when set', () => {
    const headers = headerBuilder('pitchbook_company_bio')
    expect(headers({ apiKey: 'abc' }).Authorization).toBe('PB-Token abc')
    expect(headers({ apiKey: 'abc' })['X-Currency']).toBeUndefined()
    expect(headers({ apiKey: 'abc', currency: 'JPY' })['X-Currency']).toBe('JPY')
  })

  it('never echoes the API key back in an unauthorized error', async () => {
    const transform = tools.pitchbook_company_bio.transformResponse!
    const res = new Response(
      JSON.stringify({ reason: 'UNAUTHORIZED', message: 'Active API key sk-secret-123 not found' }),
      { status: 401 }
    )
    await expect(transform(res)).rejects.toThrow(/rejected the API key/)
    const res2 = new Response(
      JSON.stringify({ reason: 'UNAUTHORIZED', message: 'Active API key sk-secret-123 not found' }),
      { status: 401 }
    )
    await expect(transform(res2)).rejects.not.toThrow(/sk-secret-123/)
  })

  it('surfaces a non-auth PitchBook error message', async () => {
    const transform = tools.pitchbook_company_bio.transformResponse!
    const res = new Response(JSON.stringify({ reason: 'NOT_FOUND', message: 'No company found' }), {
      status: 404,
    })
    await expect(transform(res)).rejects.toThrow('No company found (NOT_FOUND)')
  })

  it('renames the per-operation filter subblocks onto their API param names', () => {
    const mapped = blockParams({
      operation: 'patent_search',
      apiKey: 'k',
      companyId: '10618-03',
      patentStatus: 'Active',
      patentCpcSectionCode: 'G',
      patentFilingAuthority: 'EP',
    })
    expect(mapped.pbId).toBe('10618-03')
    expect(mapped.status).toBe('Active')
    expect(mapped.cpcSectionCode).toBe('G')
    expect(mapped.filingAuthorityLocation).toBe('EP')
    expect(mapped.patentStatus).toBeUndefined()
  })

  it('parses the bulk article id list and posts it as PitchBook expects', async () => {
    const mapped = blockParams({
      operation: 'credit_news_bulk',
      apiKey: 'k',
      articleIds: '[11041384, 2142401]',
    })
    expect(mapped.articleIds).toEqual([11041384, 2142401])

    const body = bodyBuilder('pitchbook_credit_news_bulk')
    expect(body({ apiKey: 'k', articleIds: [11041384, 2142401] })).toEqual({
      items: [{ articleId: 11041384 }, { articleId: 2142401 }],
    })
  })

  it('rejects a non-list of article ids with a message instead of a TypeError', () => {
    const body = bodyBuilder('pitchbook_credit_news_bulk')
    expect(body({ apiKey: 'k', articleIds: '[11041384, 2142401]' })).toEqual({
      items: [{ articleId: 11041384 }, { articleId: 2142401 }],
    })
    expect(() => body({ apiKey: 'k', articleIds: '{}' })).toThrow(/JSON array of numbers/)
    expect(() => body({ apiKey: 'k', articleIds: ['abc'] })).toThrow(/not a number/)
  })

  it('builds the updates URL from whichever window field is set', () => {
    const url = urlBuilder('pitchbook_company_updates')
    expect(url({ apiKey: 'k', pbId: '1-1', sinceDate: '>2024-03-01' })).toContain(
      'sinceDate=%3E2024-03-01'
    )
    expect(url({ apiKey: 'k', pbId: '1-1', trailingRange: 10 })).toContain('trailingRange=10')
    expect(url({ apiKey: 'k', pbId: '1-1' })).toBe(
      'https://api.pitchbook.com/companies/1-1/updates'
    )
  })

  it('puts the shared-search entity type in the path, not the query', () => {
    const url = urlBuilder('pitchbook_shared_search')
    const built = url({ apiKey: 'k', entityType: 'COMPANIES', searchId: 'abc', hash: 'def' })
    expect(built).toBe('https://api.pitchbook.com/COMPANIES/search?searchId=abc&hash=def')
  })

  it('trims identifiers before putting them in the path or query', () => {
    const bio = urlBuilder('pitchbook_company_bio')
    expect(bio({ apiKey: 'k', pbId: '  10618-03\n' })).toBe(
      'https://api.pitchbook.com/companies/10618-03/bio'
    )

    const cash = urlBuilder('pitchbook_fund_cash_flows')
    expect(cash({ apiKey: 'k', pbId: ' 11373-13F ', period: ' 4Q2018 ' })).toBe(
      'https://api.pitchbook.com/funds/11373-13F/cashflows/4Q2018'
    )

    const shared = urlBuilder('pitchbook_shared_search')
    expect(
      shared({ apiKey: 'k', entityType: ' COMPANIES ', searchId: ' abc ', hash: ' def ' })
    ).toBe('https://api.pitchbook.com/COMPANIES/search?searchId=abc&hash=def')
  })

  it('omits activeContract unless the user picks a side, since PitchBook is tri-state', () => {
    const cfg = PitchBookBlock.tools.config
    const run = (contractFilter?: string) =>
      blockParams({ operation: 'contracts_history', apiKey: 'k', contractFilter })

    expect(run('all').activeContract).toBeUndefined()
    expect(run(undefined).activeContract).toBeUndefined()
    expect(run('active').activeContract).toBe(true)
    expect(run('past').activeContract).toBe(false)

    const url = urlBuilder('pitchbook_contracts_history')
    expect(url({ apiKey: 'k' })).toBe('https://api.pitchbook.com/contracts/history')
    expect(url({ apiKey: 'k', activeContract: true })).toContain('activeContract=true')
    expect(url({ apiKey: 'k', activeContract: false })).toContain('activeContract=false')
  })

  it('maps every recorded PitchBook response without dropping or inventing keys', async () => {
    let checked = 0
    for (const [toolId, body] of Object.entries(RECORDED) as Array<[string, unknown]>) {
      const tool = tools[toolId]
      expect(tool, `no tool registered for ${toolId}`).toBeDefined()
      const result = await tool.transformResponse!(
        new Response(JSON.stringify(body), { status: 200 })
      )
      expect(result.success, `${toolId} did not succeed`).toBe(true)

      const declared = Object.keys(tool.outputs ?? {}).sort()
      const produced = Object.keys(result.output).sort()
      expect(produced, `${toolId} output keys drifted from its declared outputs`).toEqual(declared)

      for (const [key, value] of Object.entries(result.output)) {
        expect(value, `${toolId}.${key} is undefined`).not.toBeUndefined()
        const declaredType = tool.outputs?.[key]?.type
        if (declaredType === 'array') {
          expect(Array.isArray(value), `${toolId}.${key} declared array but is not`).toBe(true)
        }
      }
      checked++
    }
    expect(checked).toBe(Object.keys(RECORDED).length)
  })

  it('renames a filter only for the operation that owns it, so stale advanced values cannot leak', () => {
    // coCountry belongs to company_search; dealCountry to deal_search. The
    // serializer emits both when both hold values, whatever operation is active.
    const asCompany = blockParams({
      operation: 'company_search',
      apiKey: 'k',
      coCountry: 'USA',
      dealCountry: 'FRA',
    })
    expect(asCompany.country).toBe('USA')

    const asDeal = blockParams({
      operation: 'deal_search',
      apiKey: 'k',
      coCountry: 'USA',
      dealCountry: 'FRA',
    })
    expect(asDeal.country).toBe('FRA')

    // A filter owned by neither operation is cleared, not passed through.
    const asPeople = blockParams({
      operation: 'people_search',
      apiKey: 'k',
      coCountry: 'USA',
      dealCountry: 'FRA',
    })
    expect(asPeople.country).toBeUndefined()
  })

  it('reads only the ID subblock its operation owns, so a stale ID cannot retarget the call', () => {
    // A leftover dealId must not hijack a company lookup — that would spend
    // credits fetching the wrong resource with no visible cue.
    const asCompany = blockParams({
      operation: 'company_bio',
      apiKey: 'k',
      companyId: '10618-03',
      dealId: '52721-65T',
      entityId: '51261-67',
    })
    expect(asCompany.pbId).toBe('10618-03')

    const asDeal = blockParams({
      operation: 'deal_bio',
      apiKey: 'k',
      companyId: '10618-03',
      dealId: '52721-65T',
    })
    expect(asDeal.pbId).toBe('52721-65T')

    // An operation that takes no entity ID must not inherit one.
    const asSearch = blockParams({
      operation: 'company_search',
      apiKey: 'k',
      companyId: '10618-03',
      dealId: '52721-65T',
    })
    expect(asSearch.pbId).toBeUndefined()
  })

  it('exposes every window and paging field its operation actually accepts', () => {
    const visibleFor = (operation: string) =>
      new Set(
        PitchBookBlock.subBlocks
          .filter((sub) => {
            const condition = sub.condition
            if (!condition || condition.field !== 'operation') return true
            const values = Array.isArray(condition.value) ? condition.value : [condition.value]
            return values.includes(operation)
          })
          .map((sub) => sub.id)
      )

    // Each tool declares these; the canvas must offer them too.
    expect(visibleFor('entity_news').has('sinceDate')).toBe(true)
    expect(visibleFor('shared_search').has('page')).toBe(true)
    expect(visibleFor('shared_search').has('perPage')).toBe(true)
    expect(visibleFor('company_social_analytics').has('compare')).toBe(true)
  })

  it('clears cleared numeric fields instead of sending an empty string', () => {
    const mapped = blockParams({
      operation: 'company_search',
      apiKey: 'k',
      page: '',
      perPage: 'abc',
      trailingRange: '',
    })
    expect(mapped.page).toBeUndefined()
    expect(mapped.perPage).toBeUndefined()
    expect(mapped.trailingRange).toBeUndefined()

    const url = urlBuilder('pitchbook_company_search')
    expect(url({ apiKey: 'k', page: undefined, perPage: undefined })).not.toContain('page=')
  })

  it('parses additionalFilters even when a model passes it as a JSON string', () => {
    const url = urlBuilder('pitchbook_company_search')
    const built = url({ apiKey: 'k', additionalFilters: '{"locationType":"HQ_ONLY"}' })
    expect(built).toContain('locationType=HQ_ONLY')
    expect(built).not.toContain('0=%7B')
  })

  it('sends a Content-Type on the one POST endpoint', () => {
    const headers = headerBuilder('pitchbook_credit_news_bulk')
    expect(headers({ apiKey: 'k' })['Content-Type']).toBe('application/json')
  })

  it('returns the sandbox list for any entity type, not just companies', async () => {
    const transform = tools.pitchbook_sandbox_entities.transformResponse!
    const investors = await transform(
      new Response(
        JSON.stringify({
          entityTypeCounts: { investors: 2 },
          investors: [{ investorId: '1-1', investorName: 'A' }],
        }),
        { status: 200 }
      )
    )
    expect(investors.output.entities).toEqual([{ investorId: '1-1', investorName: 'A' }])
  })

  it('normalizes an array-root response and a missing nested field', async () => {
    const deals = await tools.pitchbook_company_deals.transformResponse!(
      new Response(JSON.stringify([{ dealId: '1-T' }]), { status: 200 })
    )
    expect(deals.output.deals).toEqual([{ dealId: '1-T' }])

    const bio = await tools.pitchbook_company_bio.transformResponse!(
      new Response(JSON.stringify({ companyId: '10618-03' }), { status: 200 })
    )
    expect(bio.output.companyId).toBe('10618-03')
    expect(bio.output.website).toBeNull()
    expect(bio.output.universe).toEqual([])
  })
})

describe('pitchbook error extraction', () => {
  const SUBMITTED_KEY = 'pb_live_5f3c9a1e7d24'

  it('never surfaces the submitted API key from a 401 body', () => {
    const message = extractErrorMessage(
      {
        status: 401,
        statusText: 'Unauthorized',
        data: { reason: 'UNAUTHORIZED', message: `Active API key ${SUBMITTED_KEY} not found` },
      },
      ErrorExtractorId.PITCHBOOK_ERRORS
    )

    expect(message).not.toContain(SUBMITTED_KEY)
    expect(message).toBe(
      'PitchBook rejected the API key. Check that the key is active and has API access.'
    )
  })

  it('redacts the echoed key from the body kept on the failed result', () => {
    const redacted = redactErrorData(
      {
        status: 401,
        statusText: 'Unauthorized',
        data: { reason: 'UNAUTHORIZED', message: `Active API key ${SUBMITTED_KEY} not found` },
      },
      ErrorExtractorId.PITCHBOOK_ERRORS
    )

    expect(JSON.stringify(redacted)).not.toContain(SUBMITTED_KEY)
  })

  it('keeps the body intact for a non-auth failure', () => {
    expect(
      redactErrorData(
        { status: 404, statusText: 'Not Found', data: { reason: 'NOT_FOUND', message: 'gone' } },
        ErrorExtractorId.PITCHBOOK_ERRORS
      )
    ).toEqual({ reason: 'NOT_FOUND', message: 'gone' })
  })

  it('surfaces a non-auth error with its reason', () => {
    expect(
      extractErrorMessage(
        {
          status: 404,
          statusText: 'Not Found',
          data: { reason: 'NOT_FOUND', message: 'Company not found' },
        },
        ErrorExtractorId.PITCHBOOK_ERRORS
      )
    ).toBe('Company not found (NOT_FOUND)')
  })

  /**
   * Every tool without an `errorExtractor` walks the generic chain this extractor
   * sits in, so a 401 from an unrelated service must not be reported as a
   * PitchBook auth failure. These bodies are ones no earlier extractor claims —
   * a body carrying `error`/`detail` never reaches here, so it would not test it.
   */
  it.each([
    ['an empty body', {}],
    ['a bare reason', { reason: 'UNAUTHORIZED' }],
    ['a code/title envelope', { code: 'unauthorized', title: 'Bad key' }],
    ['an unrecognized key', { err_msg: 'nope' }],
  ])('does not claim a foreign 401 with %s', (_label, data) => {
    const foreign = extractErrorMessage({ status: 401, statusText: 'Unauthorized', data })

    expect(foreign).not.toContain('PitchBook')
  })

  /**
   * The direct `redactErrorData` assertions above pass even when the executor is
   * not wired to it, so this drives the real failure path: the rejected key must
   * not appear anywhere in the tool result, message or retained body.
   */
  it('keeps the rejected key out of the whole failed tool result', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          reason: 'UNAUTHORIZED',
          message: `Active API key ${SUBMITTED_KEY} not found`,
        }),
        { status: 401, headers: { 'content-type': 'application/json' } }
      )
    )

    try {
      const result = await executeTool('pitchbook_company_bio', {
        apiKey: SUBMITTED_KEY,
        pbId: '10618-03',
      })

      expect(result.success).toBe(false)
      expect(JSON.stringify(result.output ?? {})).not.toContain(SUBMITTED_KEY)
      expect(result.error ?? '').not.toContain(SUBMITTED_KEY)
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('routes every pitchbook tool through the scrubbing extractor', () => {
    const pitchbookTools = Object.entries(tools).filter(([id]) => id.startsWith('pitchbook_'))

    expect(pitchbookTools.length).toBe(91)
    const unwired = pitchbookTools
      .filter(([, tool]) => tool.errorExtractor !== ErrorExtractorId.PITCHBOOK_ERRORS)
      .map(([id]) => id)
    expect(unwired).toEqual([])
  })
})

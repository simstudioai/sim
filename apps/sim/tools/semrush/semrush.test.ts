/**
 * @vitest-environment node
 *
 * Response fixtures are copied verbatim from the Semrush API reference examples
 * at https://developer.semrush.com/api/v3/analytics/.
 */
import { describe, expect, it, vi } from 'vitest'

/**
 * Only this service's configs are needed; the full registry is ~6,000 modules.
 * Registration is asserted through the generated `@/tools/tool-ids`.
 */
vi.mock('@/tools/registry', async () => {
  const { partialToolRegistry } = await import('@sim/testing/mocks/tool-registry.mock')
  return { tools: partialToolRegistry(await import('@/tools/semrush')) }
})

import { SemrushBlock } from '@/blocks/blocks/semrush'
import type { SubBlockConfig } from '@/blocks/types'
import { tools } from '@/tools/registry'
import { semrushBacklinksOverviewTool } from '@/tools/semrush/backlinks_overview'
import { semrushBatchKeywordOverviewTool } from '@/tools/semrush/batch_keyword_overview'
import { semrushDomainOrganicKeywordsTool } from '@/tools/semrush/domain_organic_keywords'
import { semrushDomainOverviewTool } from '@/tools/semrush/domain_overview'
import { semrushDomainVsDomainTool } from '@/tools/semrush/domain_vs_domain'
import { semrushKeywordDifficultyTool } from '@/tools/semrush/keyword_difficulty'
import { semrushOrganicResultsTool } from '@/tools/semrush/organic_results'
import { semrushReferringDomainsTool } from '@/tools/semrush/referring_domains'
import { getColumnDef } from '@/tools/semrush/utils'
import { semrushWinnersAndLosersTool } from '@/tools/semrush/winners_and_losers'
import { hasToolId } from '@/tools/tool-ids'
import type { ToolConfig } from '@/tools/types'

function csvResponse(body: string, status = 200): Response {
  return new Response(body, { status })
}

/** Builds a tool's request URL with its own parameter type, not an erased one. */
function requestUrl<P>(tool: ToolConfig<P, never>, params: P): URL {
  const { url } = tool.request
  if (typeof url !== 'function') throw new Error(`${tool.id} has a static request URL`)
  return new URL(url(params))
}

describe('semrush domain overview', () => {
  it('maps the documented CSV row onto the overview output', async () => {
    const body = [
      'Domain;Rank;Organic Keywords;Organic Traffic;Organic Cost;Adwords Keywords;Adwords Traffic;Adwords Cost',
      'seobook.com;24041;5249;37332;143496;0;0;0',
    ].join('\n')

    const result = await semrushDomainOverviewTool.transformResponse!(csvResponse(body))

    expect(result.output.overview).toEqual({
      domain: 'seobook.com',
      rank: 24041,
      organicKeywords: 5249,
      organicTraffic: 37332,
      organicCost: 143496,
      paidKeywords: 0,
      paidTraffic: 0,
      paidCost: 0,
    })
  })

  it('returns null when the report has only a header row', async () => {
    const result = await semrushDomainOverviewTool.transformResponse!(
      csvResponse('Domain;Rank;Organic Keywords\n')
    )

    expect(result.output.overview).toBeNull()
  })

  it('surfaces an ERROR body returned with HTTP 200', async () => {
    await expect(
      semrushDomainOverviewTool.transformResponse!(
        csvResponse('ERROR 132 :: API UNITS BALANCE IS ZERO')
      )
    ).rejects.toThrow('ERROR 132 :: API UNITS BALANCE IS ZERO')
  })

  it('surfaces a non-2xx body', async () => {
    await expect(
      semrushDomainOverviewTool.transformResponse!(csvResponse('ERROR 50 :: NOTHING FOUND', 400))
    ).rejects.toThrow('ERROR 50 :: NOTHING FOUND')
  })

  it('requests the columns it decodes', () => {
    const parsed = requestUrl(semrushDomainOverviewTool, {
      apiKey: 'k',
      domain: 'seobook.com',
      database: 'us',
    })

    expect(parsed.searchParams.get('type')).toBe('domain_rank')
    expect(parsed.searchParams.get('export_columns')).toBe('Dn,Rk,Or,Ot,Oc,Ad,At,Ac')
    expect(parsed.searchParams.get('export_escape')).toBe('1')
    expect(parsed.searchParams.get('display_date')).toBeNull()
  })
})

describe('decoding columns the API drops', () => {
  /**
   * `phrase_these` accepts `Td` and then omits the Trends column from the
   * response, which is what proves a report may return fewer columns than were
   * asked for.
   */
  it('decodes a report that omits a trailing requested column', async () => {
    const body = [
      'Keyword;Search Volume;CPC;Competition;Number of Results;Keyword Difficulty Index;Intents',
      'ebay;45500000;0.54;0.01;1880000000;95.10;2',
    ].join('\n')

    const result = await semrushBatchKeywordOverviewTool.transformResponse!(csvResponse(body))

    expect(result.output.keywords[0]).toEqual({
      keyword: 'ebay',
      searchVolume: 45500000,
      cpc: 0.54,
      competition: 0.01,
      numberOfResults: 1880000000,
      keywordDifficulty: 95.1,
      intents: [2],
    })
    expect(result.output.keywords[0]).not.toHaveProperty('trends')
  })

  /**
   * The damaging case: a column dropped from the middle slides every later
   * value one key to the left if the row is decoded by position.
   */
  it('keeps later fields on their own keys when a middle column is omitted', async () => {
    const body = [
      'Keyword;Position;Previous Position;Position Difference;Search Volume;CPC;Url;Traffic (%);Traffic Cost (%);Competition;Number of Results;Keyword Difficulty Index;Intents;Trends',
      'seo;9;10;1;110000;14.82;http://www.seobook.com/;17.53;44.40;0.50;678000000;78.35;1;0.81,1.00',
    ].join('\n')

    const result = await semrushDomainOrganicKeywordsTool.transformResponse!(csvResponse(body))

    expect(result.output.keywords[0]).toEqual({
      keyword: 'seo',
      position: 9,
      previousPosition: 10,
      positionDifference: 1,
      searchVolume: 110000,
      cpc: 14.82,
      url: 'http://www.seobook.com/',
      trafficPercent: 17.53,
      trafficCost: 44.4,
      competition: 0.5,
      numberOfResults: 678000000,
      keywordDifficulty: 78.35,
      intents: [1],
      trends: [0.81, 1.0],
    })
  })

  it('drops an unrecognised column rather than shifting the ones after it', async () => {
    const body = [
      'Keyword;Something New;Search Volume;CPC;Competition;Number of Results',
      'seo;xyz;110000;14.82;0.5;678000000',
    ].join('\n')

    const result = await semrushBatchKeywordOverviewTool.transformResponse!(csvResponse(body))

    expect(result.output.keywords[0]).toMatchObject({
      keyword: 'seo',
      searchVolume: 110000,
      cpc: 14.82,
      competition: 0.5,
      numberOfResults: 678000000,
    })
  })

  /**
   * `Fk` and `Fp` both render as `SERP Features`; only the order they were
   * requested in tells them apart.
   */
  it('disambiguates two columns sharing a header label by request order', async () => {
    const body = [
      'Position;Position type;Domain;Url;Keywords SERP Features;SERP Features',
      '1;organic;moz.com;https://moz.com/beginners-guide-to-seo;1,6;6',
    ].join('\n')

    const result = await semrushOrganicResultsTool.transformResponse!(csvResponse(body))

    expect(result.output.results[0]).toEqual({
      position: 1,
      positionType: 'organic',
      domain: 'moz.com',
      url: 'https://moz.com/beginners-guide-to-seo',
      keywordSerpFeatures: [1, 6],
      serpFeatures: [6],
    })
  })

  it('reads a comma-delimited, fully quoted body', async () => {
    const body = ['Keyword,Keyword Difficulty Index', '"ebay","95.10"'].join('\n')

    const result = await semrushKeywordDifficultyTool.transformResponse!(csvResponse(body))

    expect(result.output.keywords).toEqual([{ keyword: 'ebay', keywordDifficulty: 95.1 }])
  })
})

describe('semrush domain organic keywords', () => {
  it('parses trends into a numeric series', async () => {
    const body = [
      'Keyword;Position;Previous Position;Position Difference;Search Volume;CPC;Url;Traffic (%);Traffic;Traffic Cost (%);Competition;Number of Results;Keyword Difficulty Index;Intents;Trends',
      'seo;9;10;1;110000;14.82;http://www.seobook.com/;17.53;19300;44.40;0.50;0;78.35;1;0.81,1.00,1.00',
    ].join('\n')

    const result = await semrushDomainOrganicKeywordsTool.transformResponse!(csvResponse(body))

    expect(result.output.keywords).toHaveLength(1)
    expect(result.output.keywords[0]).toMatchObject({
      keyword: 'seo',
      position: 9,
      previousPosition: 10,
      positionDifference: 1,
      searchVolume: 110000,
      cpc: 14.82,
      url: 'http://www.seobook.com/',
      trafficPercent: 17.53,
      traffic: 19300,
      trafficCost: 44.4,
      keywordDifficulty: 78.35,
      intents: [1],
      trends: [0.81, 1.0, 1.0],
    })
  })

  it('keeps quoted values containing the delimiter intact', async () => {
    const body = ['Keyword;Position;Url;Trends', '"seo; tools";9;"http://x.test/a;b";'].join('\n')

    const result = await semrushDomainOrganicKeywordsTool.transformResponse!(csvResponse(body))

    expect(result.output.keywords[0].keyword).toBe('seo; tools')
    expect(result.output.keywords[0].url).toBe('http://x.test/a;b')
    expect(result.output.keywords[0].trends).toEqual([])
  })

  it('never sends a zero row limit for a positive fractional one', () => {
    const parsed = requestUrl(semrushDomainOrganicKeywordsTool, {
      apiKey: 'k',
      domain: 'a.com',
      database: 'us',
      limit: 0.5,
    })

    expect(parsed.searchParams.get('display_limit')).toBe('1')
  })

  it('clamps the row limit to the ceiling a workflow can hold', () => {
    const parsed = requestUrl(semrushDomainOrganicKeywordsTool, {
      apiKey: 'k',
      domain: 'a.com',
      database: 'us',
      limit: 999999,
    })

    expect(parsed.searchParams.get('display_limit')).toBe('100000')
  })
})

describe('semrush keyword difficulty', () => {
  it('skips the blank lines the report interleaves between rows', async () => {
    const body = 'Keyword;Keyword Difficulty Index\n\nebay;95.10\n\nseo;78.35\n'

    const result = await semrushKeywordDifficultyTool.transformResponse!(csvResponse(body))

    expect(result.output.keywords).toEqual([
      { keyword: 'ebay', keywordDifficulty: 95.1 },
      { keyword: 'seo', keywordDifficulty: 78.35 },
    ])
  })
})

describe('semrush winners and losers', () => {
  it('maps the month-over-month difference columns', async () => {
    const body = [
      'Domain;Rank;Organic Keywords;Organic Traffic;Organic Cost;Adwords Keywords;Adwords Traffic;Adwords Cost;Organic Keywords Difference;Organic Traffic Difference;Organic Cost Difference;Adwords Keywords Difference;Adwords Traffic Difference;Adwords Cost Difference',
      'wikipedia.org;1;83084012;1953530514;1766901500;98;6375;9285;469000;176196;-1008051;1;3;13',
    ].join('\n')

    const result = await semrushWinnersAndLosersTool.transformResponse!(csvResponse(body))

    expect(result.output.domains[0]).toMatchObject({
      domain: 'wikipedia.org',
      organicKeywordsDifference: 469000,
      organicTrafficDifference: 176196,
      organicCostDifference: -1008051,
      paidKeywordsDifference: 1,
      paidTrafficDifference: 3,
      paidCostDifference: 13,
    })
  })
})

describe('semrush backlinks reports', () => {
  it('maps the backlinks overview totals', async () => {
    const body = [
      'ascore;total;domains_num;urls_num;ips_num;ipclassc_num;follows_num;nofollows_num;sponsored_num;ugc_num;texts_num;images_num;forms_num;frames_num',
      '74;22063983;49145;13059030;47793;22956;20457307;1606307;258;1475;21784602;278624;437;320',
    ].join('\n')

    const result = await semrushBacklinksOverviewTool.transformResponse!(csvResponse(body))

    expect(result.output.overview).toMatchObject({
      authorityScore: 74,
      total: 22063983,
      domainsNum: 49145,
      framesNum: 320,
    })
  })

  it('defaults the referring domains target scope to the whole root domain', () => {
    const parsed = requestUrl(semrushReferringDomainsTool, {
      apiKey: 'k',
      target: 'searchenginejournal.com',
    })

    expect(parsed.origin + parsed.pathname).toBe('https://api.semrush.com/analytics/v1/')
    expect(parsed.searchParams.get('target_type')).toBe('root_domain')
    expect(parsed.searchParams.get('database')).toBeNull()
  })

  it('maps referring domain rows', async () => {
    const body = [
      'domain_ascore;domain;backlinks_num;ip;country;first_seen;last_seen',
      '86;libsyn.com;1850868;204.16.246.222;us;1495338484;1580410670',
    ].join('\n')

    const result = await semrushReferringDomainsTool.transformResponse!(csvResponse(body))

    expect(result.output.domains[0]).toEqual({
      domainAuthorityScore: 86,
      domain: 'libsyn.com',
      backlinksNum: 1850868,
      ip: '204.16.246.222',
      country: 'us',
      firstSeen: 1495338484,
      lastSeen: 1580410670,
    })
  })
})

describe('semrush domain vs. domain', () => {
  const params = { apiKey: 'k', domains: 'nike.com, adidas.com, reebok.com', database: 'us' }

  it('asks for one position column per submitted domain', () => {
    const parsed = requestUrl(semrushDomainVsDomainTool, params)

    expect(parsed.searchParams.get('export_columns')).toBe('Ph,P0,P1,P2,Co,Nq,Cp')
    expect(parsed.searchParams.get('domains')).toBe('*|or|nike.com|*|or|adidas.com|*|or|reebok.com')
  })

  it('keys each position by the domain named in the CSV header', async () => {
    const body = [
      'Keyword;nike.com;adidas.com;reebok.com;Competition;Search Volume;CPC',
      'shoes;69;33;81;1.00;1500000;0.91',
    ].join('\n')

    const result = await semrushDomainVsDomainTool.transformResponse!(csvResponse(body))

    expect(result.output.domains).toEqual(['nike.com', 'adidas.com', 'reebok.com'])
    expect(result.output.keywords[0]).toEqual({
      keyword: 'shoes',
      positions: { 'nike.com': 69, 'adidas.com': 33, 'reebok.com': 81 },
      competition: 1,
      searchVolume: 1500000,
      cpc: 0.91,
    })
  })

  it('locates the metric columns by header when a position column is missing', async () => {
    const body = [
      'Keyword;nike.com;reebok.com;Competition;Search Volume;CPC',
      'shoes;69;81;1.00;1500000;0.91',
    ].join('\n')

    const result = await semrushDomainVsDomainTool.transformResponse!(csvResponse(body))

    expect(result.output.domains).toEqual(['nike.com', 'reebok.com'])
    expect(result.output.keywords[0]).toEqual({
      keyword: 'shoes',
      positions: { 'nike.com': 69, 'reebok.com': 81 },
      competition: 1,
      searchVolume: 1500000,
      cpc: 0.91,
    })
  })

  it('leaves a metric null when the report omits its column', async () => {
    const body = ['Keyword;nike.com;Competition;CPC', 'shoes;69;1.00;0.91'].join('\n')

    const result = await semrushDomainVsDomainTool.transformResponse!(csvResponse(body))

    expect(result.output.keywords[0]).toEqual({
      keyword: 'shoes',
      positions: { 'nike.com': 69 },
      competition: 1,
      searchVolume: null,
      cpc: 0.91,
    })
  })
})

describe('semrush registry surface', () => {
  const semrushTools = Object.entries(tools).filter(([id]) => id.startsWith('semrush_'))

  it('registers every tool under its own id', () => {
    expect(semrushTools).toHaveLength(44)
    for (const [id, tool] of semrushTools) {
      expect((tool as ToolConfig).id).toBe(id)
      expect(hasToolId(id), `${id} registry`).toBe(true)
    }
  })

  /**
   * A column code with no entry in the shared map throws at decode time, which
   * would otherwise only surface on a live call.
   */
  it('resolves every column code the tools request', () => {
    for (const [, tool] of semrushTools) {
      const url = (tool as ToolConfig<Record<string, string>, never>).request.url
      if (typeof url !== 'function') continue
      const built = url({
        apiKey: 'k',
        domain: 'a.com',
        subdomain: 'b.a.com',
        url: 'https://a.com/p',
        phrase: 'seo',
        phrases: 'seo;ebay',
        domains: 'a.com,b.com',
        target: 'a.com',
        database: 'us',
      })
      const codes = new URL(built).searchParams.get('export_columns')?.split(',') ?? []
      expect(codes.length).toBeGreaterThan(0)
      for (const code of codes) {
        if (/^P\d$/.test(code)) continue
        expect(() => getColumnDef(code)).not.toThrow()
      }
    }
  })
})

describe('semrush block alignment', () => {
  const access = SemrushBlock.tools.access
  const operationOptions = (
    SemrushBlock.subBlocks.find((sub) => sub.id === 'operation')?.options as
      | Array<{ id: string }>
      | undefined
  )?.map((option) => option.id)

  function conditionValues(sub: SubBlockConfig): string[] {
    const value = (sub.condition as { value?: unknown } | undefined)?.value
    if (value === undefined) return []
    return Array.isArray(value) ? (value as string[]) : [value as string]
  }

  it('offers exactly one dropdown option per accessible tool', () => {
    expect(operationOptions).toEqual(access)
  })

  it('selects each operation own tool', () => {
    for (const operation of access) {
      expect(SemrushBlock.tools.config?.tool({ operation })).toBe(operation)
    }
  })

  it('falls back to the default operation for an unknown value', () => {
    expect(SemrushBlock.tools.config?.tool({ operation: 'nope' })).toBe('semrush_domain_overview')
  })

  it('gives every subBlock a unique id', () => {
    const ids = SemrushBlock.subBlocks.map((sub) => sub.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  /**
   * The tool is the contract: anything it marks required must be reachable on
   * the card for the operations that select it, and nothing may be offered for
   * an operation whose tool does not accept it.
   */
  it('shows a field for exactly the operations whose tool declares it', () => {
    const conditioned = SemrushBlock.subBlocks.filter(
      (sub) => sub.id !== 'operation' && sub.condition
    )

    for (const operation of access) {
      const tool = tools[operation] as ToolConfig
      const toolParams = Object.entries(tool.params)
      const shown = conditioned
        .filter((sub) => conditionValues(sub).includes(operation))
        .map((sub) => sub.id)

      for (const [name, config] of toolParams) {
        if (name === 'apiKey') continue
        expect(shown, `${operation} is missing a field for ${name}`).toContain(name)
        if (config.required) {
          const sub = conditioned.find((candidate) => candidate.id === name)
          const required = (sub?.required as { value?: unknown } | undefined)?.value
          const requiredFor = Array.isArray(required) ? (required as string[]) : [required]
          expect(requiredFor, `${operation}.${name} must be required`).toContain(operation)
        }
      }

      const accepted = new Set(toolParams.map(([name]) => name))
      for (const id of shown) {
        expect(accepted, `${operation} offers ${id}, which its tool ignores`).toContain(id)
      }
    }
  })
})

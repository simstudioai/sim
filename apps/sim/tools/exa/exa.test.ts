/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { ExaBlock } from '@/blocks/blocks/exa'
import { agentTool } from '@/tools/exa/agent'
import { answerTool } from '@/tools/exa/answer'
import { findSimilarLinksTool } from '@/tools/exa/find_similar_links'
import { getContentsTool } from '@/tools/exa/get_contents'
import { searchTool } from '@/tools/exa/search'
import { applyFreshness, resolveCategory } from '@/tools/exa/utils'

const API_KEY = 'test-key'

function searchBody(params: Record<string, unknown>) {
  return searchTool.request.body?.({ query: 'q', apiKey: API_KEY, ...params } as never) as Record<
    string,
    any
  >
}

describe('applyFreshness', () => {
  it('sends maxAgeHours alone, since Exa 400s when both controls are present', () => {
    const target: Record<string, unknown> = {}
    applyFreshness(target, { maxAgeHours: 24, livecrawl: 'never' })
    expect(target).toEqual({ maxAgeHours: 24 })
  })

  it('treats maxAgeHours of 0 as a real value rather than falsy', () => {
    const target: Record<string, unknown> = {}
    applyFreshness(target, { maxAgeHours: 0, livecrawl: 'always' })
    expect(target).toEqual({ maxAgeHours: 0 })
  })

  it('keeps -1 (cache only) distinct from an unset value', () => {
    const target: Record<string, unknown> = {}
    applyFreshness(target, { maxAgeHours: -1 })
    expect(target).toEqual({ maxAgeHours: -1 })
  })

  it('falls back to deprecated livecrawl when no maxAgeHours is set', () => {
    const target: Record<string, unknown> = {}
    applyFreshness(target, { livecrawl: 'always' })
    expect(target).toEqual({ livecrawl: 'always' })
  })

  it('sends neither control when the user configured neither', () => {
    const target: Record<string, unknown> = {}
    applyFreshness(target, {})
    expect(target).toEqual({})
  })
})

describe('resolveCategory', () => {
  it('remaps retired categories onto their current equivalents', () => {
    expect(resolveCategory('research_paper')).toBe('publication')
    expect(resolveCategory('news_article')).toBe('news')
    expect(resolveCategory('personal_site')).toBe('personal site')
    expect(resolveCategory('linkedin profile')).toBe('people')
  })

  it('passes current categories through untouched', () => {
    expect(resolveCategory('company')).toBe('company')
    expect(resolveCategory('financial report')).toBe('financial report')
  })

  it('passes through categories with no modern equivalent', () => {
    expect(resolveCategory('github')).toBe('github')
  })

  it('omits an unset category', () => {
    expect(resolveCategory(undefined)).toBeUndefined()
    expect(resolveCategory('')).toBeUndefined()
  })
})

describe('exa_search request body', () => {
  it('nests content options under contents, which /search requires', () => {
    const body = searchBody({ text: true, highlights: true, summary: true })
    expect(body.contents).toEqual({ text: true, highlights: true, summary: true })
    expect(body.text).toBeUndefined()
  })

  it('preserves an object-form text param so per-caller character caps survive', () => {
    const body = searchBody({ text: { maxCharacters: 500 } })
    expect(body.contents.text).toEqual({ maxCharacters: 500 })
  })

  it('prefers a summary query over the plain summary toggle', () => {
    const body = searchBody({ summary: true, summaryQuery: 'what do they sell' })
    expect(body.contents.summary).toEqual({ query: 'what do they sell' })
  })

  it('never sends livecrawl alongside maxAgeHours', () => {
    const body = searchBody({ livecrawl: 'never', maxAgeHours: 24 })
    expect(body.contents.maxAgeHours).toBe(24)
    expect(body.contents.livecrawl).toBeUndefined()
  })

  it('remaps a legacy category saved by an older workflow', () => {
    expect(searchBody({ category: 'research_paper' }).category).toBe('publication')
  })

  it('still accepts legacy search types saved by older workflows', () => {
    expect(searchBody({ type: 'neural' }).type).toBe('neural')
  })

  it('splits comma-separated domain filters into arrays', () => {
    const body = searchBody({ includeDomains: 'a.com, b.com ,, c.com' })
    expect(body.includeDomains).toEqual(['a.com', 'b.com', 'c.com'])
  })

  it('parses a stringified outputSchema from the JSON editor', () => {
    const body = searchBody({ outputSchema: '{"type":"object"}' })
    expect(body.outputSchema).toEqual({ type: 'object' })
  })

  it('rejects a malformed outputSchema instead of sending it', () => {
    expect(() => searchBody({ outputSchema: '{not json' })).toThrow(/Invalid outputSchema/)
  })

  it('omits contents entirely when no content options were set', () => {
    expect(searchBody({}).contents).toBeUndefined()
  })
})

describe('exa_get_contents request body', () => {
  const body = (params: Record<string, unknown>) =>
    getContentsTool.request.body?.({ apiKey: API_KEY, ...params } as never) as Record<string, any>

  it('places content options at the top level, unlike /search', () => {
    const result = body({ urls: 'https://a.com', text: true, highlights: true })
    expect(result.text).toBe(true)
    expect(result.highlights).toBe(true)
    expect(result.contents).toBeUndefined()
  })

  it('accepts ids as an alternative selector to urls', () => {
    const result = body({ ids: 'id-1, id-2' })
    expect(result.ids).toEqual(['id-1', 'id-2'])
    expect(result.urls).toBeUndefined()
  })

  it('rejects both selectors, which Exa 400s on', () => {
    expect(() => body({ urls: 'https://a.com', ids: 'id-1' })).toThrow(/not both/)
  })

  it('rejects neither selector', () => {
    expect(() => body({})).toThrow(/requires either urls or ids/)
  })
})

describe('exa_answer', () => {
  it('describes text as controlling source text, not the answer', () => {
    expect(answerTool.params.text.description).toMatch(/cited source/i)
  })

  it('parses a stringified outputSchema', () => {
    const body = answerTool.request.body?.({
      query: 'q',
      apiKey: API_KEY,
      outputSchema: '{"type":"object"}',
    } as never) as Record<string, any>
    expect(body.outputSchema).toEqual({ type: 'object' })
  })
})

describe('exa block', () => {
  it('routes the retired research operation to the agent tool', () => {
    expect(ExaBlock.tools.config?.tool?.({ operation: 'exa_research' })).toBe('exa_agent')
  })

  it('carries a saved research model over to an agent effort level', () => {
    const params = ExaBlock.tools.config?.params?.({
      operation: 'exa_research',
      model: 'exa-research-pro',
    }) as Record<string, unknown>
    expect(params.effort).toBe('high')
  })

  it('keeps the old standard research depth when no model was stored', () => {
    const params = ExaBlock.tools.config?.params?.({
      operation: 'exa_research',
    }) as Record<string, unknown>
    expect(params.effort).toBe('medium')
  })

  it('leaves both Get Contents selectors optional so the ids-only path stays valid', () => {
    for (const id of ['urls', 'ids']) {
      const selector = ExaBlock.subBlocks.find(
        (block) => block.id === id && block.condition?.value === 'exa_get_contents'
      )
      expect(selector?.required).toBeUndefined()
    }
  })

  it('keeps the legacy model sub-block so the serializer preserves its value', () => {
    const model = ExaBlock.subBlocks.find((block) => block.id === 'model')
    expect(model?.condition?.value).toBe('exa_research')
  })

  it('does not map a model value on non-research operations', () => {
    const params = ExaBlock.tools.config?.params?.({
      operation: 'exa_agent',
      model: 'exa-research-pro',
    }) as Record<string, unknown>
    expect(params.effort).toBeUndefined()
  })

  it('coerces maxAgeHours of 0 rather than dropping it as falsy', () => {
    const params = ExaBlock.tools.config?.params?.({
      operation: 'exa_search',
      maxAgeHours: '0',
    }) as Record<string, unknown>
    expect(params.maxAgeHours).toBe(0)
  })

  it('offers only categories Exa currently supports', () => {
    const category = ExaBlock.subBlocks.find(
      (block) => block.id === 'category' && block.condition?.value === 'exa_search'
    )
    expect(category?.options).toEqual([
      { label: 'None', id: '' },
      { label: 'Company', id: 'company' },
      { label: 'Publication', id: 'publication' },
      { label: 'News', id: 'news' },
      { label: 'Personal Site', id: 'personal site' },
      { label: 'Financial Report', id: 'financial report' },
      { label: 'People', id: 'people' },
    ])
  })

  it('no longer defaults live crawling to never, which suppressed fresh content', () => {
    expect(ExaBlock.subBlocks.some((block) => block.id === 'livecrawl')).toBe(false)
  })

  it('exposes every operation it advertises', () => {
    const operations = ExaBlock.subBlocks.find((block) => block.id === 'operation')
    const advertised = operations?.options as { id: string }[]
    expect(advertised.map((option) => option.id).sort()).toEqual([...ExaBlock.tools.access!].sort())
  })
})

describe('exa_agent terminal statuses', () => {
  const settle = (status: string, stopReason: string | null = null) =>
    agentTool.postProcess?.(
      {
        success: true,
        output: { runId: 'agent_run_1', status, stopReason, text: '', structured: { a: 1 } },
      } as never,
      { apiKey: API_KEY, query: 'q' } as never,
      {} as never
    )

  it('reports a run that is already failed on creation as a failure', async () => {
    const result = await settle('failed', 'error')
    expect(result?.success).toBe(false)
    expect(result?.error).toMatch(/failed: error/)
  })

  it('reports a cancelled run as a failure', async () => {
    const result = await settle('cancelled')
    expect(result?.success).toBe(false)
    expect(result?.error).toMatch(/cancelled/)
  })

  it('emits the retired research output shape so saved references still resolve', async () => {
    const result = await agentTool.postProcess?.(
      {
        success: true,
        output: { runId: 'agent_run_1', status: 'completed', text: 'the answer' },
      } as never,
      { apiKey: API_KEY, query: 'q' } as never,
      {} as never
    )
    expect(result?.output.research).toEqual([
      { title: 'Research Complete', url: '', summary: 'the answer', text: 'the answer', score: 1 },
    ])
  })

  it('falls back to the structured payload when a completed run has no text', async () => {
    const result = await settle('completed')
    expect(result?.success).toBe(true)
    expect(result?.output.text).toBe(JSON.stringify({ a: 1 }, null, 2))
  })

  it('fails when the create call returns no run ID', async () => {
    const result = await agentTool.postProcess?.(
      { success: true, output: { text: '' } } as never,
      { apiKey: API_KEY, query: 'q' } as never,
      {} as never
    )
    expect(result?.success).toBe(false)
    expect(result?.error).toMatch(/run ID/)
  })
})

describe('find similar links', () => {
  it('is marked deprecated so new workflows prefer search', () => {
    expect(findSimilarLinksTool.description).toMatch(/deprecated/i)
  })
})

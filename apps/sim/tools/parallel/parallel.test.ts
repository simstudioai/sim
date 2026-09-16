/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ParallelBlock } from '@/blocks/blocks/parallel'
import { deepResearchTool } from '@/tools/parallel/deep_research'
import { extractTool } from '@/tools/parallel/extract'
import { resolveSearchMode, searchTool, toList } from '@/tools/parallel/search'

vi.mock('@/lib/core/telemetry', () => ({
  PlatformEvents: { hostedKeyUnknownModelCost: vi.fn() },
}))

const API_KEY = 'test-key'

function searchBody(params: Record<string, unknown>) {
  return searchTool.request.body?.({
    search_queries: 'q',
    apiKey: API_KEY,
    ...params,
  } as never) as Record<string, unknown>
}

function extractBody(params: Record<string, unknown>) {
  return extractTool.request.body?.({
    urls: 'https://a.com',
    apiKey: API_KEY,
    ...params,
  } as never) as Record<string, unknown>
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('toList', () => {
  it('splits comma-separated strings and drops blanks', () => {
    expect(toList(' a.com, ,b.com ')).toEqual(['a.com', 'b.com'])
  })

  it('passes arrays through trimmed', () => {
    expect(toList([' a ', 'b'])).toEqual(['a', 'b'])
  })
})

describe('resolveSearchMode', () => {
  it('maps retired beta modes onto their V1 equivalents', () => {
    expect(resolveSearchMode('one-shot')).toBe('basic')
    expect(resolveSearchMode('agentic')).toBe('advanced')
  })

  it('passes V1 modes through and omits an unset mode', () => {
    expect(resolveSearchMode('turbo')).toBe('turbo')
    expect(resolveSearchMode(undefined)).toBeUndefined()
  })
})

describe('parallel_search request', () => {
  it('targets the GA endpoint without the beta header', () => {
    expect(searchTool.request.url).toBe('https://api.parallel.ai/v1/search')
    const headers = (searchTool.request.headers as (p: unknown) => Record<string, string>)({
      apiKey: API_KEY,
    })
    expect(headers['parallel-beta']).toBeUndefined()
    expect(headers['x-api-key']).toBe(API_KEY)
  })

  it('requires search_queries and treats objective as optional', () => {
    expect(searchTool.params.search_queries.required).toBe(true)
    expect(searchTool.params.objective.required).toBe(false)
  })

  it('nests max_results, excerpt settings and source policy under advanced_settings', () => {
    const body = searchBody({
      search_queries: 'UN founding year, United Nations established',
      objective: 'When was the UN founded?',
      max_results: '15',
      max_chars_per_result: '2000',
      include_domains: 'un.org, .edu',
      exclude_domains: 'wikipedia.org',
    })
    expect(body).toEqual({
      search_queries: ['UN founding year', 'United Nations established'],
      objective: 'When was the UN founded?',
      advanced_settings: {
        max_results: 15,
        excerpt_settings: { max_chars_per_result: 2000 },
        source_policy: {
          include_domains: ['un.org', '.edu'],
          exclude_domains: ['wikipedia.org'],
        },
      },
    })
  })

  it('omits advanced_settings and mode when nothing optional is set', () => {
    expect(searchBody({})).toEqual({ search_queries: ['q'] })
  })

  it('translates a legacy mode saved by an older block', () => {
    expect(searchBody({ mode: 'agentic' }).mode).toBe('advanced')
  })
})

describe('parallel_search pricing', () => {
  const getCost = (searchTool.hosting?.pricing as { getCost: (p: unknown, o: unknown) => unknown })
    .getCost

  it('charges the cheaper base for turbo and fast modes', () => {
    expect(getCost({ mode: 'turbo' }, { results: [] })).toMatchObject({ cost: 0.001 })
    expect(getCost({ mode: 'fast' }, { results: [] })).toMatchObject({ cost: 0.001 })
  })

  it('charges the advanced base by default plus extra results beyond ten', () => {
    const results = Array.from({ length: 12 }, () => ({}))
    expect(getCost({}, { results })).toMatchObject({ cost: 0.005 + 2 * 0.001 })
  })
})

describe('parallel_extract request', () => {
  it('targets the GA endpoint and nests full_content under advanced_settings', () => {
    expect(extractTool.request.url).toBe('https://api.parallel.ai/v1/extract')
    expect(extractBody({ full_content: true })).toEqual({
      urls: ['https://a.com'],
      advanced_settings: { full_content: true },
    })
  })

  it('never sends the removed excerpts toggle', () => {
    expect(extractTool.params.excerpts).toBeUndefined()
    expect(extractBody({ excerpts: false })).toEqual({ urls: ['https://a.com'] })
  })

  it('fails when every URL errored', async () => {
    const result = await extractTool.transformResponse!(
      jsonResponse({
        extract_id: 'ex_1',
        results: [],
        errors: [{ url: 'https://a.com', error_type: 'fetch_error', http_status_code: 404 }],
      }),
      {} as never
    )
    expect(result.success).toBe(false)
    expect(result.error).toContain('https://a.com')
    expect(result.output.errors).toEqual([
      { url: 'https://a.com', error_type: 'fetch_error', http_status_code: 404, content: null },
    ])
  })

  it('keeps partial results alongside per-URL errors', async () => {
    const result = await extractTool.transformResponse!(
      jsonResponse({
        extract_id: 'ex_1',
        results: [{ url: 'https://a.com', excerpts: ['x'] }],
        errors: [{ url: 'https://b.com', error_type: 'timeout' }],
      }),
      {} as never
    )
    expect(result.success).toBe(true)
    expect(result.output.results).toHaveLength(1)
    expect(result.output.errors).toHaveLength(1)
  })
})

describe('parallel_deep_research', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('defaults to a text schema and disables event streaming', () => {
    const body = deepResearchTool.request.body?.({
      input: 'HVAC market',
      apiKey: API_KEY,
      include_domains: 'a.com',
    } as never) as Record<string, unknown>
    expect(body.task_spec).toEqual({ output_schema: { type: 'text' } })
    expect(body.enable_events).toBe(false)
    expect(body.processor).toBe('pro')
    expect(body.source_policy).toEqual({ include_domains: ['a.com'] })
  })

  it('sends the object-form auto schema when structured output is requested', () => {
    const body = deepResearchTool.request.body?.({
      input: 'HVAC market',
      output_format: 'auto',
      apiKey: API_KEY,
    } as never) as Record<string, unknown>
    expect(body.task_spec).toEqual({ output_schema: { type: 'auto' } })
  })

  it('reads the run status from the nested run object and waits with a timeout', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        status: 'queued',
        run: { run_id: 'run_1', status: 'completed' },
        output: { type: 'json', content: { summary: 'ok' }, basis: [] },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await deepResearchTool.postProcess!(
      {
        success: true,
        output: { run_id: 'run_1', status: 'queued', message: '', content: {}, basis: [] },
      },
      { apiKey: API_KEY, input: 'x' } as never,
      vi.fn() as never
    )

    expect(fetchMock.mock.calls[0][0]).toMatch(
      /^https:\/\/api\.parallel\.ai\/v1\/tasks\/runs\/run_1\/result\?timeout=\d+$/
    )
    expect(result.success).toBe(true)
    expect(result.output.status).toBe('completed')
    expect(result.output.content).toEqual({ summary: 'ok' })
  })
})

describe('Parallel block', () => {
  const params = ParallelBlock.tools.config!.params!

  it('requires search queries and lists only V1 search modes', () => {
    const queries = ParallelBlock.subBlocks.find((s) => s.id === 'search_queries')
    const mode = ParallelBlock.subBlocks.find((s) => s.id === 'search_mode')
    expect(queries?.required).toBe(true)
    expect(mode?.options).toEqual([
      { label: 'Advanced', id: 'advanced' },
      { label: 'Basic', id: 'basic' },
      { label: 'Fast', id: 'fast' },
      { label: 'Turbo', id: 'turbo' },
    ])
  })

  it('no longer exposes the removed excerpts toggle', () => {
    expect(ParallelBlock.subBlocks.some((s) => s.id === 'excerpts')).toBe(false)
    expect(ParallelBlock.inputs?.excerpts).toBeUndefined()
  })

  it('coerces the full_content switch and drops the excerpts flag', () => {
    expect(params({ operation: 'extract', full_content: 'true' })).toEqual({
      full_content: true,
    })
    expect(params({ operation: 'extract', full_content: false })).toEqual({
      full_content: false,
    })
  })

  it('falls back to the objective as the query for workflows saved before queries were required', () => {
    expect(params({ operation: 'search', objective: 'When was the UN founded?' })).toMatchObject({
      search_queries: 'When was the UN founded?',
    })
    expect(
      params({ operation: 'search', objective: 'x', search_queries: 'UN founding' })
    ).not.toHaveProperty('search_queries')
  })

  it('forwards the deep research output format', () => {
    expect(
      params({ operation: 'deep_research', research_input: 'q', output_format: 'auto' })
    ).toEqual({ input: 'q', output_format: 'auto' })
  })

  it('forwards the search mode and numeric limits at execution time', () => {
    expect(
      params({
        operation: 'search',
        search_mode: 'fast',
        max_results: '5',
        search_include_domains: 'a.com',
      })
    ).toEqual({
      mode: 'fast',
      max_results: 5,
      include_domains: 'a.com',
      exclude_domains: undefined,
    })
  })
})

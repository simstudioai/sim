/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GlasserBlock } from '@/blocks/blocks/glasser'
import { companyIntelligenceTool } from '@/tools/glasser/company_intelligence'
import { peopleSearchTool } from '@/tools/glasser/people_search'
import { GLASSER_API_BASE, pollRun } from '@/tools/glasser/run'
import { seoResearchTool } from '@/tools/glasser/seo_research'
import { socialResearchTool } from '@/tools/glasser/social_research'
import type { GlasserRun } from '@/tools/glasser/types'
import { webResearchTool } from '@/tools/glasser/web_research'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const run = (overrides: Partial<GlasserRun> = {}): GlasserRun => ({
  id: 'run_1',
  run_url: 'https://glasser.ai/runs/run_1',
  provider: 'apollo',
  endpoint: '/v1/people/search',
  endpoint_version: 3,
  status: 'COMPLETED',
  failure: null,
  input: {},
  output: { people: [{ name: 'Patrick Collison' }] },
  provider_response: { http_status: 200 },
  charge_usd: '0.01',
  charge_basis: { clause: 'rule', quantity: 1 },
  stoppable: false,
  stop_requested_at: null,
  created_at: '2026-09-23T00:00:00Z',
  started_at: '2026-09-23T00:00:00Z',
  completed_at: '2026-09-23T00:00:01Z',
  task_id: null,
  ...overrides,
})

const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('glasser request shape', () => {
  it('posts to the gtm solution with a bearer key and a fresh idempotency key per call', () => {
    const headers = peopleSearchTool.request.headers as (p: any) => Record<string, string>
    const first = headers({ apiKey: 'gl_test' })
    const second = headers({ apiKey: 'gl_test' })

    expect(peopleSearchTool.request.url).toBe(`${GLASSER_API_BASE}/v1/solutions/gtm/people_search`)
    expect(first.Authorization).toBe('Bearer gl_test')
    expect(first['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/)
    expect(first['Idempotency-Key']).not.toBe(second['Idempotency-Key'])
  })

  it('splits comma-separated lists and drops blank fields', () => {
    const body = peopleSearchTool.request.body!({
      apiKey: 'gl_test',
      action: 'search',
      job_titles: 'CTO, VP Engineering, ',
      seniorities: 'c_suite,vp',
      locations: '',
      company_domain: ' stripe.com ',
      limit: 5,
    })

    expect(body).toStrictEqual({
      action: 'search',
      job_titles: ['CTO', 'VP Engineering'],
      seniorities: ['c_suite', 'vp'],
      company_domain: 'stripe.com',
      limit: 5,
    })
  })

  it('sends keywords as a list for SEO and platform plus mode for social', () => {
    expect(
      seoResearchTool.request.body!({ apiKey: 'k', action: 'keyword_overview', keywords: 'a, b' })
    ).toStrictEqual({ action: 'keyword_overview', keywords: ['a', 'b'] })
    expect(
      socialResearchTool.request.body!({
        apiKey: 'k',
        platform: 'reddit',
        mode: 'profile',
        handle: 'rust',
      })
    ).toStrictEqual({ platform: 'reddit', mode: 'profile', handle: 'rust' })
  })

  it('projects the query as model input only for the answer action', () => {
    const modelInput = webResearchTool.request.modelInput
    if (!modelInput || modelInput.mode !== 'project') throw new Error('Expected a projection')
    expect(modelInput.select({ apiKey: 'k', query: 'q', action: 'search' })).toStrictEqual({})
    expect(modelInput.select({ apiKey: 'k', query: 'q', action: 'answer' })).toStrictEqual({
      query: 'q',
    })
  })
})

describe('glasser run mapping', () => {
  const transform = companyIntelligenceTool.transformResponse!

  it('maps a completed run to the envelope plus provider-native output', async () => {
    const result = await transform(respond(run()))

    expect(result.success).toBe(true)
    expect(result.output).toStrictEqual({
      id: 'run_1',
      run_url: 'https://glasser.ai/runs/run_1',
      status: 'COMPLETED',
      provider: 'apollo',
      endpoint: '/v1/people/search',
      output: { people: [{ name: 'Patrick Collison' }] },
      charge_usd: '0.01',
      failure: null,
      task_id: null,
    })
  })

  it('reports a failed run with its failure message', async () => {
    const result = await transform(
      respond(
        run({
          status: 'FAILED',
          failure: { kind: 'TIMED_OUT', message: 'Provider timed out' },
          output: null,
          charge_usd: '0.00',
        })
      )
    )

    expect(result.success).toBe(false)
    expect(result.error).toBe('Provider timed out')
    expect(result.output.status).toBe('FAILED')
  })
})

describe('glasser polling', () => {
  it('returns a terminal run untouched', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const initial = await companyIntelligenceTool.transformResponse!(respond(run()))

    const result = await pollRun(initial, { apiKey: 'k' })

    expect(result).toBe(initial)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reads an in-flight run until it completes', async () => {
    vi.useFakeTimers()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respond(run({ status: 'RUNNING', output: null })))
      .mockResolvedValueOnce(respond(run()))
    vi.stubGlobal('fetch', fetchMock)
    const initial = await companyIntelligenceTool.transformResponse!(
      respond(run({ status: 'QUEUED', output: null }), 202)
    )

    const pending = pollRun(initial, { apiKey: 'k' })
    await vi.advanceTimersByTimeAsync(4000)
    const result = await pending

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][0]).toBe(`${GLASSER_API_BASE}/v1/runs/run_1`)
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer k')
    expect(result.success).toBe(true)
    expect(result.output.status).toBe('COMPLETED')
  })

  it('gives up after repeated polling errors', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockImplementation(async () => respond({ error: 'down' }, 503))
    vi.stubGlobal('fetch', fetchMock)
    const initial = await companyIntelligenceTool.transformResponse!(
      respond(run({ status: 'QUEUED', output: null }), 202)
    )

    const pending = pollRun(initial, { apiKey: 'k' })
    await vi.advanceTimersByTimeAsync(6000)
    const result = await pending

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(result.success).toBe(false)
    expect(result.error).toContain('503')
  })
})

describe('glasser block params', () => {
  const toParams = GlasserBlock.tools.config!.params!

  it('routes the operation to its tool and folds the action field', () => {
    expect(GlasserBlock.tools.config!.tool!({ operation: 'glasser_seo_research' })).toBe(
      'glasser_seo_research'
    )
    expect(
      toParams({
        operation: 'glasser_seo_research',
        seo_action: 'keyword_ideas',
        seo_keywords: 'ai agents',
        ci_action: 'enrich',
        limit: '10',
        apiKey: 'k',
      })
    ).toStrictEqual({ action: 'keyword_ideas', keywords: 'ai agents', limit: 10, apiKey: 'k' })
  })

  it('joins multi-select values and maps platform and mode for social', () => {
    expect(
      toParams({
        operation: 'glasser_people_search',
        ps_action: 'search',
        seniorities: ['vp', 'c_suite'],
        job_titles: '',
        apiKey: 'k',
      })
    ).toStrictEqual({ action: 'search', seniorities: 'vp,c_suite', apiKey: 'k' })
    expect(
      toParams({
        operation: 'glasser_social_research',
        sr_platform: 'x',
        sr_mode: 'feed',
        handle: 'sim',
        apiKey: 'k',
      })
    ).toStrictEqual({ platform: 'x', mode: 'feed', handle: 'sim', apiKey: 'k' })
  })
})

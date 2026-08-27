/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { TinyFishBlock } from '@/blocks/blocks/tinyfish'
import { cancelRunTool } from '@/tools/tinyfish/cancel_run'
import { fetchUrlsTool } from '@/tools/tinyfish/fetch_urls'
import { getRunTool } from '@/tools/tinyfish/get_run'
import { TINYFISH_AGENT_STEP_USD } from '@/tools/tinyfish/hosting'
import { listRunsTool } from '@/tools/tinyfish/list_runs'
import { listVaultItemsTool } from '@/tools/tinyfish/list_vault_items'
import { runTool } from '@/tools/tinyfish/run'
import { runAsyncTool } from '@/tools/tinyfish/run_async'
import { searchTool } from '@/tools/tinyfish/search'
import { buildAutomationBody, parseJsonSchema, parseList } from '@/tools/tinyfish/utils'

const API_KEY = 'test-key'

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

describe('buildAutomationBody', () => {
  it('sends only the required fields plus the integration tag by default', () => {
    expect(buildAutomationBody({ url: 'https://example.com', goal: 'Find pricing' })).toEqual({
      url: 'https://example.com',
      goal: 'Find pricing',
      api_integration: 'sim',
    })
  })

  it('nests agent mode and max steps under agent_config', () => {
    const body = buildAutomationBody({
      url: 'https://example.com',
      goal: 'Find pricing',
      agentMode: 'strict',
      maxSteps: 50,
    })
    expect(body.agent_config).toEqual({ mode: 'strict', max_steps: 50 })
  })

  it('omits agent_config entirely when neither field is set', () => {
    const body = buildAutomationBody({ url: 'https://example.com', goal: 'Find pricing' })
    expect(body).not.toHaveProperty('agent_config')
  })

  it('sends the Tetra proxy with a country when the proxy is enabled', () => {
    const body = buildAutomationBody({
      url: 'https://example.com',
      goal: 'Find pricing',
      proxyEnabled: true,
      proxyCountryCode: 'GB',
    })
    expect(body.proxy_config).toEqual({ enabled: true, type: 'tetra', country_code: 'GB' })
  })

  it('drops a country code when the proxy is off, rather than sending a disabled proxy', () => {
    const body = buildAutomationBody({
      url: 'https://example.com',
      goal: 'Find pricing',
      proxyCountryCode: 'GB',
    })
    expect(body).not.toHaveProperty('proxy_config')
  })

  it('scopes vault credentials only when the vault is opted into', () => {
    const scoped = buildAutomationBody({
      url: 'https://example.com',
      goal: 'Log in',
      useVault: true,
      credentialItemIds: 'cred:a:Work:1, cred:b:Home:2',
    })
    expect(scoped.use_vault).toBe(true)
    expect(scoped.credential_item_ids).toEqual(['cred:a:Work:1', 'cred:b:Home:2'])

    const unscoped = buildAutomationBody({
      url: 'https://example.com',
      goal: 'Log in',
      credentialItemIds: 'cred:a:Work:1',
    })
    expect(unscoped).not.toHaveProperty('use_vault')
    expect(unscoped).not.toHaveProperty('credential_item_ids')
  })

  it('parses a stringified output schema into an object', () => {
    const body = buildAutomationBody({
      url: 'https://example.com',
      goal: 'Find pricing',
      outputSchema: '{"type":"object","properties":{"price":{"type":"number"}}}',
    })
    expect(body.output_schema).toEqual({
      type: 'object',
      properties: { price: { type: 'number' } },
    })
  })
})

describe('parseJsonSchema', () => {
  it('treats an empty or whitespace-only schema as unset', () => {
    expect(parseJsonSchema('   ')).toBeUndefined()
    expect(parseJsonSchema(undefined)).toBeUndefined()
  })

  it('rejects a schema that is not a JSON object', () => {
    expect(() => parseJsonSchema('[1, 2]')).toThrow('Output Schema must be a JSON object')
  })
})

describe('parseList', () => {
  it('splits on commas and newlines and drops blank entries', () => {
    expect(parseList('https://a.com,\n https://b.com , ')).toEqual([
      'https://a.com',
      'https://b.com',
    ])
  })

  it('passes an array through untouched apart from trimming', () => {
    expect(parseList([' https://a.com ', ''])).toEqual(['https://a.com'])
  })
})

describe('tinyfish_run', () => {
  it('maps a completed run onto camelCase outputs', async () => {
    const result = await runTool.transformResponse!(
      jsonResponse({
        run_id: 'run-1',
        status: 'COMPLETED',
        started_at: '2026-01-01T00:00:00Z',
        finished_at: '2026-01-01T00:00:30Z',
        num_of_steps: 5,
        result: { price: 799 },
        schema_validation: { valid: true, re_prompt_attempts: 0, errors: [] },
        error: null,
      })
    )

    expect(result.success).toBe(true)
    expect(result.output).toEqual({
      runId: 'run-1',
      status: 'COMPLETED',
      startedAt: '2026-01-01T00:00:00Z',
      finishedAt: '2026-01-01T00:00:30Z',
      numOfSteps: 5,
      result: { price: 799 },
      schemaValidation: { valid: true, rePromptAttempts: 0, errors: [] },
      error: null,
    })
  })

  it('reports a FAILED run as a failure even though the HTTP status is 200', async () => {
    const result = await runTool.transformResponse!(
      jsonResponse({
        run_id: 'run-2',
        status: 'FAILED',
        started_at: '2026-01-01T00:00:00Z',
        finished_at: '2026-01-01T00:02:00Z',
        num_of_steps: 42,
        result: null,
        schema_validation: null,
        error: {
          code: 'service_busy',
          message: 'Browser crashed',
          category: 'SYSTEM_FAILURE',
          retry_after: 60,
          help_url: 'https://docs.tinyfish.ai/prompting-guide',
        },
      })
    )

    expect(result.success).toBe(false)
    expect(result.error).toBe('Browser crashed')
    expect(result.output.result).toBeNull()
  })

  it('exposes the error category and retry delay so a workflow can branch on them', async () => {
    const result = await runTool.transformResponse!(
      jsonResponse({
        run_id: 'run-2',
        status: 'FAILED',
        started_at: null,
        finished_at: null,
        num_of_steps: 42,
        result: null,
        schema_validation: null,
        error: {
          code: 'service_busy',
          message: 'Browser crashed',
          category: 'SYSTEM_FAILURE',
          retry_after: 60,
          help_url: 'https://docs.tinyfish.ai/prompting-guide',
        },
      })
    )

    expect(result.output.error).toEqual({
      code: 'service_busy',
      message: 'Browser crashed',
      category: 'SYSTEM_FAILURE',
      retryAfter: 60,
      helpUrl: 'https://docs.tinyfish.ai/prompting-guide',
      helpMessage: null,
    })
  })

  /**
   * Documents a known gap rather than asserting desired behavior: the executor
   * meters only successful executions, so the steps a failed run consumed are
   * charged to the hosted wallet and billed to nobody.
   */
  it('still reports the step count of a failed run, which goes unbilled today', async () => {
    const result = await runTool.transformResponse!(
      jsonResponse({
        run_id: 'run-2',
        status: 'FAILED',
        started_at: null,
        finished_at: null,
        num_of_steps: 42,
        result: null,
        schema_validation: null,
        error: { message: 'Browser crashed', category: 'SYSTEM_FAILURE' },
      })
    )

    expect(result.success).toBe(false)
    expect(result.output.numOfSteps).toBe(42)
  })

  it('surfaces the API error code and message on a non-2xx response', async () => {
    await expect(
      runTool.transformResponse!(
        jsonResponse(
          { error: { code: 'INVALID_API_KEY', message: 'Invalid or expired API key' } },
          { status: 401 }
        )
      )
    ).rejects.toThrow('INVALID_API_KEY: Invalid or expired API key')
  })

  it('falls back to the status line when the error body is not parseable', async () => {
    await expect(
      runTool.transformResponse!(new Response('gateway down', { status: 502 }))
    ).rejects.toThrow('TinyFish request failed with status 502')
  })
})

describe('tinyfish model input', () => {
  it('projects the goal, which the agent model reads verbatim', () => {
    const select =
      runTool.request.modelInput?.mode === 'project' && runTool.request.modelInput.select
    expect(select).toBeTruthy()
    expect(
      (select as (p: never) => unknown)({
        goal: 'Find pricing',
        outputSchema: '{"type":"object"}',
      } as never)
    ).toEqual({ goal: 'Find pricing', outputSchema: '{"type":"object"}' })
  })

  it('leaves the target URL unprojected, since it is a resource locator', () => {
    const select =
      runTool.request.modelInput?.mode === 'project' && runTool.request.modelInput.select
    const selection = (select as (p: never) => Record<string, unknown>)({
      goal: 'Find pricing',
      url: 'https://example.com',
    } as never)
    expect(selection).not.toHaveProperty('url')
  })

  it('projects the output schema, which TinyFish re-prompts the agent model with', () => {
    const select =
      runTool.request.modelInput?.mode === 'project' && runTool.request.modelInput.select
    const selection = (select as (p: never) => Record<string, unknown>)({
      goal: 'Find pricing',
      outputSchema: { type: 'object' },
    } as never)
    expect(selection.outputSchema).toEqual({ type: 'object' })
  })

  it('projects the goal on the async run too', () => {
    expect(runAsyncTool.request.modelInput?.mode).toBe('project')
  })
})

describe('tinyfish hosted-key config', () => {
  it('bills the synchronous run on the steps the API reported', () => {
    const pricing = runTool.hosting?.pricing
    if (pricing?.type !== 'custom') throw new Error('expected custom pricing')

    expect(pricing.getCost({} as never, { numOfSteps: 5 })).toEqual({
      cost: 5 * TINYFISH_AGENT_STEP_USD,
      metadata: { steps: 5 },
    })
  })

  it('refuses to bill a run whose step count is missing or unusable', () => {
    const pricing = runTool.hosting?.pricing
    if (pricing?.type !== 'custom') throw new Error('expected custom pricing')

    expect(() => pricing.getCost({} as never, { numOfSteps: null })).toThrow('num_of_steps')
    expect(() => pricing.getCost({} as never, { numOfSteps: 'five' })).toThrow('non-numeric')
  })

  it('charges nothing for the free Search and Fetch products', () => {
    expect(searchTool.hosting?.pricing).toEqual({ type: 'per_request', cost: 0 })
    expect(fetchUrlsTool.hosting?.pricing).toEqual({ type: 'per_request', cost: 0 })
  })

  it('throttles Fetch on URLs, the axis TinyFish itself limits', () => {
    const rateLimit = fetchUrlsTool.hosting?.rateLimit
    if (rateLimit?.mode !== 'custom') throw new Error('expected custom rate limit')

    const urls = rateLimit.dimensions.find((dimension) => dimension.name === 'urls')
    expect(urls?.extractUsage({ urls: 'https://a.com, https://b.com' }, {})).toBe(2)
    expect(urls?.extractUsage({}, {})).toBe(0)
  })

  it('leaves the async run and its companions off hosted keys, since they cannot be metered', () => {
    expect(runAsyncTool.hosting).toBeUndefined()
    expect(getRunTool.hosting).toBeUndefined()
    expect(cancelRunTool.hosting).toBeUndefined()
    expect(listRunsTool.hosting).toBeUndefined()
    expect(listVaultItemsTool.hosting).toBeUndefined()
  })
})

describe('tinyfish_get_run', () => {
  it('maps the run summary, recording, and steps', async () => {
    const result = await getRunTool.transformResponse!(
      jsonResponse({
        run_id: 'run-1',
        status: 'RUNNING',
        goal: 'Find pricing',
        created_at: '2026-01-01T00:00:00Z',
        started_at: '2026-01-01T00:00:05Z',
        finished_at: null,
        num_of_steps: null,
        result: null,
        schema_validation: null,
        error: null,
        streaming_url: 'https://stream.agent.tinyfish.ai/session/xyz',
        browser_config: { proxy_enabled: true, proxy_country_code: 'US' },
        video_url: null,
        steps: [
          {
            id: 'evt_1',
            timestamp: '2026-01-01T00:00:06Z',
            status: 'RUNNING',
            action: 'Click the pricing link',
            screenshot: null,
            duration: '1.2s',
          },
        ],
      })
    )

    expect(result.success).toBe(true)
    expect(result.output.streamingUrl).toBe('https://stream.agent.tinyfish.ai/session/xyz')
    expect(result.output.browserConfig).toEqual({ proxyEnabled: true, proxyCountryCode: 'US' })
    expect(result.output.numOfSteps).toBeNull()
    expect(result.output.steps).toEqual([
      {
        id: 'evt_1',
        timestamp: '2026-01-01T00:00:06Z',
        status: 'RUNNING',
        action: 'Click the pricing link',
        duration: '1.2s',
      },
    ])
  })

  it('percent-encodes the run id into the path', () => {
    const url = getRunTool.request.url as (params: { runId: string }) => string
    expect(url({ runId: ' a/b ' })).toBe('https://agent.tinyfish.ai/v1/runs/a%2Fb')
  })
})

describe('tinyfish_cancel_run', () => {
  it('reports an already-finished run without claiming it was cancelled', async () => {
    const result = await cancelRunTool.transformResponse!(
      jsonResponse({
        run_id: 'run-1',
        status: 'COMPLETED',
        cancelled_at: null,
        message: 'Run already finished',
      })
    )

    expect(result.output).toEqual({
      runId: 'run-1',
      status: 'COMPLETED',
      cancelledAt: null,
      message: 'Run already finished',
    })
  })
})

describe('tinyfish_list_runs', () => {
  it('only sends the filters that were set', () => {
    const url = listRunsTool.request.url as (params: Record<string, unknown>) => string
    expect(url({ apiKey: API_KEY })).toBe('https://agent.tinyfish.ai/v1/runs')
    expect(url({ apiKey: API_KEY, status: 'FAILED', limit: 50 })).toBe(
      'https://agent.tinyfish.ai/v1/runs?status=FAILED&limit=50'
    )
  })

  it('maps the paginated envelope', async () => {
    const result = await listRunsTool.transformResponse!(
      jsonResponse({
        data: [
          {
            run_id: 'run-1',
            status: 'COMPLETED',
            goal: 'Find pricing',
            created_at: '2026-01-01T00:00:00Z',
            started_at: null,
            finished_at: null,
            num_of_steps: 3,
            result: null,
            schema_validation: null,
            error: null,
            streaming_url: null,
            browser_config: null,
          },
        ],
        pagination: { total: 42, next_cursor: 'cursor-2', has_more: true },
      })
    )

    expect(result.output.runs).toHaveLength(1)
    expect(result.output.runs[0].runId).toBe('run-1')
    expect(result.output).toMatchObject({ total: 42, nextCursor: 'cursor-2', hasMore: true })
  })
})

describe('tinyfish_search', () => {
  it('builds the query string from the query and optional locale filters', () => {
    const url = searchTool.request.url as (params: Record<string, unknown>) => string
    expect(url({ query: 'web automation', apiKey: API_KEY })).toBe(
      'https://api.search.tinyfish.ai/?query=web+automation'
    )
    expect(url({ query: 'news', location: 'US', language: 'en', apiKey: API_KEY })).toBe(
      'https://api.search.tinyfish.ai/?query=news&location=US&language=en'
    )
  })

  it('maps ranked results onto camelCase fields', async () => {
    const result = await searchTool.transformResponse!(
      jsonResponse({
        query: 'web automation',
        results: [
          {
            position: 1,
            site_name: 'example.com',
            snippet: 'Top tools',
            title: 'Best Tools',
            url: 'https://example.com/tools',
          },
        ],
        total_results: 1,
      })
    )

    expect(result.output.results[0]).toEqual({
      position: 1,
      siteName: 'example.com',
      snippet: 'Top tools',
      title: 'Best Tools',
      url: 'https://example.com/tools',
    })
  })
})

describe('tinyfish_fetch', () => {
  it('splits the URL list and sends extraction flags only when enabled', () => {
    const body = fetchUrlsTool.request.body!({
      urls: 'https://a.com, https://b.com',
      format: 'html',
      links: true,
      apiKey: API_KEY,
    } as never) as Record<string, unknown>

    expect(body).toEqual({
      urls: ['https://a.com', 'https://b.com'],
      format: 'html',
      links: true,
    })
  })

  it('keeps per-URL failures alongside the successful results', async () => {
    const result = await fetchUrlsTool.transformResponse!(
      jsonResponse({
        results: [
          {
            url: 'https://a.com',
            final_url: 'https://www.a.com',
            title: 'A',
            description: null,
            language: 'en',
            format: 'markdown',
            text: '# A',
            author: null,
            published_date: null,
            latency_ms: 120,
          },
        ],
        errors: [{ url: 'https://b.com', error: 'Failed to fetch resource' }],
      })
    )

    expect(result.success).toBe(true)
    expect(result.output.results[0]).toMatchObject({
      finalUrl: 'https://www.a.com',
      publishedDate: null,
      latencyMs: 120,
      links: [],
      imageLinks: [],
    })
    expect(result.output.errors).toEqual([
      { url: 'https://b.com', error: 'Failed to fetch resource' },
    ])
  })
})

describe('tinyfish_fetch bounds', () => {
  function body(urls: string) {
    return () => fetchUrlsTool.request.body!({ urls, apiKey: API_KEY } as never)
  }

  it('names the empty and over-long cases instead of letting the API 400', () => {
    expect(body('  , ,')).toThrow('At least one URL is required')
    expect(
      body(Array.from({ length: 11 }, (_, index) => `https://a${index}.com`).join(','))
    ).toThrow('at most 10 URLs')
  })

  it('accepts exactly the documented maximum', () => {
    expect(
      body(Array.from({ length: 10 }, (_, index) => `https://a${index}.com`).join(','))
    ).not.toThrow()
  })
})

describe('tinyfish_list_vault_items', () => {
  it('returns display-safe metadata with the URIs a run scopes itself to', async () => {
    const result = await listVaultItemsTool.transformResponse!(
      jsonResponse({
        items: [
          {
            itemId: 'cred:conn-123:Personal:item-abc',
            connectionId: 'conn_123',
            label: 'Amazon Login',
            vaultName: 'Personal',
            domains: ['amazon.com'],
            fieldMetadata: [{ fieldId: 'password', label: 'Password', type: 'CONCEALED' }],
            hasTotp: true,
          },
        ],
      })
    )

    expect(result.output.items[0]).toEqual({
      itemId: 'cred:conn-123:Personal:item-abc',
      connectionId: 'conn_123',
      label: 'Amazon Login',
      vaultName: 'Personal',
      domains: ['amazon.com'],
      fieldMetadata: [{ fieldId: 'password', label: 'Password', type: 'CONCEALED' }],
      hasTotp: true,
    })
  })
})

describe('TinyFish block', () => {
  it('routes every operation to its own tool', () => {
    for (const toolId of TinyFishBlock.tools.access) {
      expect(TinyFishBlock.tools.config?.tool?.({ operation: toolId })).toBe(toolId)
    }
  })

  it('falls back to the synchronous run for an unknown operation', () => {
    expect(TinyFishBlock.tools.config?.tool?.({ operation: 'nope' })).toBe('tinyfish_run')
  })

  it('renames the list-runs goal filter onto the goal query the tool sends', () => {
    const params = TinyFishBlock.tools.config?.params?.({
      operation: 'tinyfish_list_runs',
      goalFilter: 'pricing',
    })
    expect(params).toMatchObject({ goal: 'pricing' })
  })

  it('leaves the automation goal alone on a run operation', () => {
    const params = TinyFishBlock.tools.config?.params?.({
      operation: 'tinyfish_run',
      goalFilter: 'pricing',
    })
    expect(params).not.toHaveProperty('goal')
  })

  it('coerces the numeric text inputs and drops them when blank', () => {
    expect(
      TinyFishBlock.tools.config?.params?.({ operation: 'tinyfish_run', maxSteps: '50' })
    ).toMatchObject({ maxSteps: 50 })
    expect(
      TinyFishBlock.tools.config?.params?.({ operation: 'tinyfish_run', maxSteps: '  ' })
    ).not.toHaveProperty('maxSteps')
  })

  it('always shows an API key field for the operations hosted keys cannot cover', () => {
    const apiKeyFields = TinyFishBlock.subBlocks.filter((subBlock) => subBlock.id === 'apiKey')
    expect(apiKeyFields).toHaveLength(2)

    const hosted = apiKeyFields.find((field) => field.hideWhenHosted)
    const unhosted = apiKeyFields.find((field) => !field.hideWhenHosted)
    expect(hosted?.condition).toMatchObject({
      field: 'operation',
      value: ['tinyfish_run', 'tinyfish_search', 'tinyfish_fetch'],
    })
    expect(unhosted?.condition).toMatchObject({ not: true })
  })
})

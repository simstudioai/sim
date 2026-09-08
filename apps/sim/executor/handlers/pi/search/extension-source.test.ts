/**
 * Loads the generated Create PR extension the way the sandbox does — as a module, driven through the
 * tool it registers — so the duplicated request building and normalization is exercised rather than
 * string-matched. Each provider's envelope is compared against `normalize.ts`, which is the only
 * thing standing between the two copies and silent drift.
 *
 * @vitest-environment node
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PI_SEARCH_PROVIDERS, type PiSearchProvider } from '@/executor/handlers/pi/core/keys'
import {
  PI_SEARCH_API_KEY_ENV_VAR,
  PI_SEARCH_EXTENSION_PATH,
  PI_SEARCH_EXTENSION_SOURCE,
  PI_SEARCH_PROVIDER_ENV_VAR,
} from '@/executor/handlers/pi/search/extension-source'
import {
  extractPiSearchRecords,
  normalizePiSearchRecords,
  PI_SEARCH_BUDGET_MESSAGE,
  PI_SEARCH_DEFAULT_RESULTS,
  PI_SEARCH_MAX_CALLS_PER_EXECUTION,
  PI_SEARCH_MAX_SNIPPET_LENGTH,
  PI_SEARCH_MAX_TITLE_LENGTH,
  PI_SEARCH_TIMEOUT_MS,
  PI_SEARCH_TOOL_NAME,
  PI_SEARCH_TRUNCATED_MESSAGE,
  serializePiSearchEnvelope,
} from '@/executor/handlers/pi/search/normalize'

interface RegisteredTool {
  name: string
  label: string
  description: string
  promptGuidelines: string[]
  parameters: Record<string, unknown>
  execute(
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<{ content: { type: string; text: string }[]; details: unknown }>
}

let loadExtension: (pi: { registerTool(tool: RegisteredTool): void }) => void
let tempDir: string

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'sim-search-extension-'))
  const modulePath = join(tempDir, 'extension.mjs')
  await writeFile(modulePath, PI_SEARCH_EXTENSION_SOURCE)
  const loaded = await import(/* @vite-ignore */ pathToFileURL(modulePath).href)
  loadExtension = loaded.default
})

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

/** Registers the extension's tool with the given env, mirroring what the sandbox provides. */
function register(provider: string, apiKey = 'key-123'): RegisteredTool {
  vi.stubEnv(PI_SEARCH_PROVIDER_ENV_VAR, provider)
  vi.stubEnv(PI_SEARCH_API_KEY_ENV_VAR, apiKey)

  let registered: RegisteredTool | undefined
  loadExtension({
    registerTool: (tool) => {
      registered = tool
    },
  })
  if (!registered) throw new Error('extension registered no tool')
  return registered
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const fetchMock = vi.fn()

beforeEach(() => {
  vi.unstubAllEnvs()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

describe('extension load', () => {
  it('is written outside the repository checkout the agent can commit', () => {
    expect(PI_SEARCH_EXTENSION_PATH).toBe('/workspace/sim-search-extension.ts')
    expect(PI_SEARCH_EXTENSION_PATH.startsWith('/workspace/repo')).toBe(false)
  })

  it('registers one tool with the same name and guidelines as the host adapter', () => {
    const tool = register('exa')
    expect(tool.name).toBe(PI_SEARCH_TOOL_NAME)
    expect(tool.promptGuidelines.join(' ')).toMatch(/untrusted/)
    expect(tool.parameters.additionalProperties).toBe(false)
  })

  it('fails loudly when the sandbox env is incomplete', () => {
    vi.stubEnv(PI_SEARCH_PROVIDER_ENV_VAR, 'exa')
    vi.stubEnv(PI_SEARCH_API_KEY_ENV_VAR, '')
    expect(() => loadExtension({ registerTool: () => {} })).toThrow(
      /requires SIM_SEARCH_PROVIDER and SIM_SEARCH_API_KEY/
    )
  })

  it('rejects an unknown provider instead of registering a broken tool', () => {
    expect(() => register('google')).toThrow(/Unsupported search provider: google/)
  })
})

describe('provider requests', () => {
  it('sends the Exa request with the key in a header and page text requested', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ results: [] }))

    await register('exa').execute('call-1', { query: 'pi agent', numResults: 3 })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.exa.ai/search')
    expect(init.method).toBe('POST')
    expect(init.headers['x-api-key']).toBe('key-123')
    expect(JSON.parse(init.body)).toEqual({
      query: 'pi agent',
      numResults: 3,
      contents: { text: { maxCharacters: 1200 } },
    })
  })

  it('sends the Serper request against the web endpoint', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ organic: [] }))

    await register('serper').execute('call-1', { query: 'pi agent', numResults: 2 })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://google.serper.dev/search')
    expect(init.headers['X-API-KEY']).toBe('key-123')
    expect(JSON.parse(init.body)).toEqual({ q: 'pi agent', num: 2 })
  })

  it('sends the Parallel request to the V1 endpoint with the query as both query and objective', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ results: [] }))

    await register('parallel').execute('call-1', { query: 'pi agent', numResults: 4 })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.parallel.ai/v1/search')
    expect(init.headers['x-api-key']).toBe('key-123')
    expect(init.headers['parallel-beta']).toBeUndefined()
    expect(JSON.parse(init.body)).toEqual({
      search_queries: ['pi agent'],
      objective: 'pi agent',
      advanced_settings: { max_results: 4 },
    })
  })

  it('sends the Firecrawl request as a bearer token with a server-side budget', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { web: [] } }))

    await register('firecrawl').execute('call-1', { query: 'pi agent' })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.firecrawl.dev/v2/search')
    expect(init.headers.Authorization).toBe('Bearer key-123')
    expect(JSON.parse(init.body)).toEqual({ query: 'pi agent', limit: 5, timeout: 10_000 })
  })

  it('defensively clamps the count and never forwards extra arguments', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ organic: [] }))

    await register('serper').execute('call-1', {
      query: '  spaced  ',
      numResults: 99,
      type: 'news',
    })

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ q: 'spaced', num: 10 })
  })

  it('rejects a blank query before spending a provider call', async () => {
    await expect(register('exa').execute('call-1', { query: '   ' })).rejects.toThrow(
      /query is required/
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('enforces the same per-execution budget as the host adapter, per extension load', async () => {
    // A fresh Response per call: a body stream can only be read once.
    fetchMock.mockImplementation(() => jsonResponse({ results: [] }))
    const tool = register('exa')

    for (let call = 0; call < PI_SEARCH_MAX_CALLS_PER_EXECUTION; call++) {
      await tool.execute('call-1', { query: `pi ${call}` })
    }

    await expect(tool.execute('call-1', { query: 'one too many' })).rejects.toThrow(
      PI_SEARCH_BUDGET_MESSAGE
    )
    expect(fetchMock).toHaveBeenCalledTimes(PI_SEARCH_MAX_CALLS_PER_EXECUTION)
    // A fresh load is a fresh sandbox run, so the count starts over.
    await expect(register('exa').execute('call-1', { query: 'fresh run' })).resolves.toBeDefined()
  })
})

describe('normalization parity with the host adapter', () => {
  // Each fixture walks its provider's whole field-fallback chain, not just the primary field: those
  // chains are the part most likely to drift between the two copies.
  const payloads: Record<PiSearchProvider, unknown> = {
    exa: {
      results: [
        {
          title: 'Exa result',
          url: 'https://example.com/exa',
          text: 'Exa page text',
          publishedDate: '2026-03-04',
        },
        { title: 'Summary only', url: 'https://example.com/summary', summary: 'Exa summary' },
        {
          title: 'Highlights only',
          url: 'https://example.com/highlights',
          highlights: ['', 'Second highlight'],
        },
        { title: 'Dropped', url: null },
      ],
    },
    serper: {
      organic: [
        { title: 'Serper result', link: 'https://example.com/serper', snippet: 'S', date: 'today' },
        { title: 'Url instead of link', url: 'https://example.com/serper-url', snippet: 'U' },
      ],
    },
    parallel: {
      results: [
        {
          title: null,
          url: 'https://example.com/parallel',
          publish_date: '2026-01-01',
          excerpts: ['', 'Second excerpt'],
        },
        {
          title: 'Camel-case date',
          url: 'https://example.com/parallel-camel',
          publishedDate: '2026-02-02',
          excerpts: ['Only excerpt'],
        },
      ],
    },
    firecrawl: {
      data: {
        web: [
          { title: 'Firecrawl result', url: 'https://example.com/firecrawl', description: 'F' },
          { title: 'Snippet instead', url: 'https://example.com/firecrawl-snippet', snippet: 'S' },
          { title: 'No link' },
        ],
      },
    },
  }

  // `Record<PiSearchProvider, unknown>` on `payloads` is not enforced anywhere — test files are
  // excluded from tsconfig and vitest only transpiles — so a provider missing here would be quietly
  // skipped by `it.each` instead of failing. This assertion is what actually holds the copies together.
  it('covers every registered search provider', () => {
    expect(Object.keys(payloads).sort()).toEqual(Object.keys(PI_SEARCH_PROVIDERS).sort())
  })

  it.each(Object.keys(payloads) as PiSearchProvider[])(
    'produces the same envelope as normalize.ts for %s',
    async (provider) => {
      const payload = payloads[provider]
      fetchMock.mockResolvedValue(jsonResponse(payload))

      const result = await register(provider).execute('call-1', { query: 'pi', numResults: 5 })

      expect(result.content[0].text).toBe(
        serializePiSearchEnvelope(
          normalizePiSearchRecords(provider, extractPiSearchRecords(provider, payload), 5)
        )
      )
      expect(result.details).toEqual({})
    }
  )

  it('reports an empty search as the shared no-results envelope', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ results: [] }))

    const result = await register('exa').execute('call-1', { query: 'pi' })
    expect(result.content[0].text).toBe(serializePiSearchEnvelope([]))
  })

  it('accepts a Firecrawl data array as well as its per-source map', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ data: [{ title: 'A', url: 'https://example.com/a', description: 'D' }] })
    )

    const result = await register('firecrawl').execute('call-1', { query: 'pi' })
    expect(JSON.parse(result.content[0].text).results).toHaveLength(1)
  })

  // `url` is dropped rather than whitespace-collapsed in both copies; a divergence here would let
  // the sandbox hand the agent a link the host modes would have refused.
  it('drops links carrying whitespace or control characters, as the host adapter does', async () => {
    const records = [
      { title: 'Space', url: 'https://example.com/a b' },
      { title: 'Newline', url: 'https://example.com/a\nb' },
      { title: 'Nul', url: 'https://example.com/a\u0000b' },
      { title: 'Del', url: 'https://example.com/a\u007fb' },
      { title: 'Kept', url: 'https://example.com/a-b_c%20d' },
    ]
    fetchMock.mockResolvedValue(jsonResponse({ results: records }))

    const result = await register('exa').execute('call-1', { query: 'pi', numResults: 10 })
    expect(result.content[0].text).toBe(
      serializePiSearchEnvelope(normalizePiSearchRecords('exa', records, 10))
    )
    expect(JSON.parse(result.content[0].text).results).toHaveLength(1)
  })

  it('treats a blank result count as absent, as the host adapter does', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ results: [] }))

    await register('exa').execute('call-1', { query: 'pi', numResults: null })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).numResults).toBe(PI_SEARCH_DEFAULT_RESULTS)
  })

  it('says so when results were dropped to fit the envelope, as the host adapter does', async () => {
    const records = Array.from({ length: 10 }, (_, i) => ({
      title: '\u898b'.repeat(PI_SEARCH_MAX_TITLE_LENGTH),
      url: `https://example.com/${i}?${'q'.repeat(1500)}`,
      text: '\u6f22'.repeat(PI_SEARCH_MAX_SNIPPET_LENGTH),
    }))
    fetchMock.mockResolvedValue(jsonResponse({ results: records }))

    const result = await register('exa').execute('call-1', { query: 'pi', numResults: 10 })
    const parsed = JSON.parse(result.content[0].text)

    expect(parsed.results.length).toBeLessThan(records.length)
    expect(parsed.message).toBe(PI_SEARCH_TRUNCATED_MESSAGE)
    expect(result.content[0].text).toBe(
      serializePiSearchEnvelope(normalizePiSearchRecords('exa', records, 10))
    )
  })
})

describe('failure handling', () => {
  it('reports an HTTP failure with the status and no credential', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'unauthorized' }, 401))

    await expect(register('exa').execute('call-1', { query: 'pi' })).rejects.toThrow(
      'Exa search was rejected as unauthorized. Check that the Exa API key is valid and has search access.'
    )
  })

  // Same classification the host adapter applies, so the agent gets the same advice in every mode.
  it('distinguishes a rate limit and a server error from a bad key', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'slow down' }, 429))
    await expect(register('exa').execute('call-1', { query: 'pi' })).rejects.toThrow(/rate limited/)

    fetchMock.mockResolvedValue(jsonResponse({ error: 'boom' }, 503))
    await expect(register('exa').execute('call-1', { query: 'pi' })).rejects.toThrow(
      'Exa search failed with HTTP 503.'
    )
  })

  it('reports its own timeout as a timeout rather than an unreachable provider', async () => {
    vi.useFakeTimers()
    try {
      fetchMock.mockImplementation(
        (_url: string, init: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () => reject(new Error('aborted')), {
              once: true,
            })
          })
      )

      const pending = register('exa').execute('call-1', { query: 'pi' })
      const assertion = expect(pending).rejects.toThrow(
        `Exa search timed out after ${PI_SEARCH_TIMEOUT_MS / 1000} seconds. Try a narrower query.`
      )
      await vi.advanceTimersByTimeAsync(PI_SEARCH_TIMEOUT_MS)
      await assertion
    } finally {
      vi.useRealTimers()
    }
  })

  it('never surfaces a transport error verbatim, since it can quote the keyed request', async () => {
    fetchMock.mockRejectedValue(new Error('connect ECONNREFUSED with header x-api-key: key-123'))

    await expect(register('exa').execute('call-1', { query: 'pi' })).rejects.toThrow(
      'Exa search could not reach the provider.'
    )
    await expect(register('exa').execute('call-1', { query: 'pi' })).rejects.not.toThrow(/key-123/)
  })

  it('reports an unparseable body without echoing it', async () => {
    fetchMock.mockResolvedValue(
      new Response('<html>rate limited</html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      })
    )

    await expect(register('serper').execute('call-1', { query: 'pi' })).rejects.toThrow(
      'Serper search returned a response that is not valid JSON.'
    )
  })

  it('refuses a response larger than the sandbox read ceiling', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ results: [{ title: 'x'.repeat(1024 * 1024 + 10), url: 'https://a.com' }] })
    )

    await expect(register('exa').execute('call-1', { query: 'pi' })).rejects.toThrow(
      /exceeded the size limit/
    )
  })

  it('aborts the provider call when the agent signal aborts', async () => {
    const controller = new AbortController()
    fetchMock.mockImplementation(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        })
    )

    const pending = register('exa').execute('call-1', { query: 'pi' }, controller.signal)
    controller.abort()

    await expect(pending).rejects.toThrow('Exa search could not reach the provider.')
  })
})

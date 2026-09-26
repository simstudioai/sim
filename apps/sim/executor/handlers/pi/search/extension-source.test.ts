/**
 * Loads the generated Create PR extension the way the sandbox does — as a module, driven through the
 * tool it registers — so the duplicated request building and normalization is exercised rather than
 * string-matched. Each provider's envelope is compared against `normalize.ts`, which is the only
 * thing standing between the two copies and silent drift.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { jsonResponse } from '@sim/testing/helpers/http'
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

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

describe('extension load', () => {
  it('is written outside the repository checkout the agent can commit', () => {
    expect(PI_SEARCH_EXTENSION_PATH).toBe('/workspace/sim-search-extension.ts')
    expect(PI_SEARCH_EXTENSION_PATH.startsWith('/workspace/repo')).toBe(false)
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

  it('defensively clamps the count and never forwards extra arguments', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ organic: [] }))

    await register('serper').execute('call-1', {
      query: '  spaced  ',
      numResults: 99,
      type: 'news',
    })

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ q: 'spaced', num: 10 })
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
})

describe('failure handling', () => {
  it('reports an HTTP failure with the status and no credential', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'unauthorized' }, 401))

    await expect(register('exa').execute('call-1', { query: 'pi' })).rejects.toThrow(
      'Exa search was rejected as unauthorized. Check that the Exa API key is valid and has search access.'
    )
  })

  it('never surfaces a transport error verbatim, since it can quote the keyed request', async () => {
    fetchMock.mockRejectedValue(new Error('connect ECONNREFUSED with header x-api-key: key-123'))

    await expect(register('exa').execute('call-1', { query: 'pi' })).rejects.toThrow(
      'Exa search could not reach the provider.'
    )
    await expect(register('exa').execute('call-1', { query: 'pi' })).rejects.not.toThrow(/key-123/)
  })

  it('refuses a response larger than the sandbox read ceiling', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ results: [{ title: 'x'.repeat(1024 * 1024 + 10), url: 'https://a.com' }] })
    )

    await expect(register('exa').execute('call-1', { query: 'pi' })).rejects.toThrow(
      /exceeded the size limit/
    )
  })
})

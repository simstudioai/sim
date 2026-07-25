/**
 * Ties the Create PR extension's hand-written requests to the Sim tools the host modes call.
 *
 * The two search paths cannot share code — Create PR has no host in the loop — so the only thing
 * keeping them equivalent is that both are derived from `buildPiSearchProviderArgs`. On the host side
 * that bag is turned into a request by each tool's own `request.body()`, which reads fields its
 * `params` never declares (`exa_search` folds `text` into `contents`, `firecrawl_search` reads
 * `limit` and `timeout`). Refactor any of those four tools and the sandbox would quietly search with
 * different parameters than the other two modes, with nothing failing. This is that failure.
 *
 * @vitest-environment node
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PiSearchProvider } from '@/executor/handlers/pi/keys'
import {
  PI_SEARCH_API_KEY_ENV_VAR,
  PI_SEARCH_EXTENSION_SOURCE,
  PI_SEARCH_PROVIDER_ENV_VAR,
} from '@/executor/handlers/pi/search/extension-source'
import {
  buildPiSearchProviderArgs,
  PI_SEARCH_TIMEOUT_MS,
} from '@/executor/handlers/pi/search/normalize'
import { searchTool as exaSearch } from '@/tools/exa/search'
import { searchTool as firecrawlSearch } from '@/tools/firecrawl/search'
import { searchTool as parallelSearch } from '@/tools/parallel/search'
import { searchTool as serperSearch } from '@/tools/serper/search'
import type { ToolConfig } from '@/tools/types'

const API_KEY = 'parity-key'
const QUERY = 'pi coding agent release notes'
const NUM_RESULTS = 4

const TOOLS: Record<PiSearchProvider, ToolConfig<any, any>> = {
  exa: exaSearch,
  serper: serperSearch,
  parallel: parallelSearch,
  firecrawl: firecrawlSearch,
}

interface CapturedRequest {
  url: string
  headers: Record<string, string>
  body: unknown
}

let loadExtension: (pi: { registerTool(tool: any): void }) => void
let tempDir: string
const fetchMock = vi.fn()

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'sim-search-parity-'))
  const modulePath = join(tempDir, 'extension.mjs')
  await writeFile(modulePath, PI_SEARCH_EXTENSION_SOURCE)
  loadExtension = (await import(/* @vite-ignore */ pathToFileURL(modulePath).href)).default
})

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

// Per test, not once: globals and env are restored between tests, and an unstubbed `fetch` here
// would reach the real providers.
beforeEach(() => {
  vi.unstubAllEnvs()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

/** Drives the sandbox tool once and reports the request it put on the wire. */
async function captureExtensionRequest(provider: PiSearchProvider): Promise<CapturedRequest> {
  vi.stubEnv(PI_SEARCH_PROVIDER_ENV_VAR, provider)
  vi.stubEnv(PI_SEARCH_API_KEY_ENV_VAR, API_KEY)
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  )

  let tool: any
  loadExtension({ registerTool: (registered) => void (tool = registered) })
  await tool.execute('call-1', { query: QUERY, numResults: NUM_RESULTS })

  const [url, init] = fetchMock.mock.calls[0]
  return { url, headers: init.headers, body: JSON.parse(init.body) }
}

/**
 * The host request for the same search: the parameter bag `buildPiSearchToolSpec` hands `executeTool`,
 * resolved through the tool's own request builders the way the transport does.
 */
function buildHostRequest(provider: PiSearchProvider): CapturedRequest {
  const tool = TOOLS[provider]
  const params = {
    ...buildPiSearchProviderArgs(provider, { query: QUERY, numResults: NUM_RESULTS }),
    apiKey: API_KEY,
    timeout: PI_SEARCH_TIMEOUT_MS,
  }

  const { url, headers, body } = tool.request
  return {
    url: typeof url === 'function' ? url(params) : url,
    headers: headers!(params),
    body: body!(params),
  }
}

describe.each(Object.keys(TOOLS) as PiSearchProvider[])('%s request parity', (provider) => {
  it('sends the same url, headers, and body from the sandbox as from the host', async () => {
    const sandbox = await captureExtensionRequest(provider)
    const host = buildHostRequest(provider)

    expect(sandbox.url).toBe(host.url)
    expect(sandbox.headers).toEqual(host.headers)
    // `sandbox.body` is already parsed off the wire; `toEqual` ignores members set to undefined, so
    // comparing the host's object directly still compares what each path would send.
    expect(sandbox.body).toEqual(host.body)
    expect(TOOLS[provider].request.method).toBe('POST')
  })
})

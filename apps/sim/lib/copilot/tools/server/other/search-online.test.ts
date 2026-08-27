/**
 * @vitest-environment node
 */
import { loggerMock, resetEnvMock, setEnv } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockExecuteTool } = vi.hoisted(() => ({
  mockExecuteTool: vi.fn(),
}))

vi.mock('@/lib/copilot/generated/tool-catalog-v1', () => ({
  WebSearch: { id: 'web_search' },
}))
vi.mock('@/tools', () => ({ executeTool: mockExecuteTool }))

import { searchOnlineServerTool } from '@/lib/copilot/tools/server/other/search-online'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

function activeQueryRegistry(): ResolvedSecretTraceRegistry {
  const registry = new ResolvedSecretTraceRegistry([
    {
      name: 'SEARCH_QUERY',
      plaintext: 'private search query',
      encryptedValue: 'encrypted-query',
    },
  ])
  registry.recordResolved('SEARCH_QUERY', 'private search query', { propagated: true })
  return registry
}

describe('online search model boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setEnv({ EXA_API_KEY: 'exa-key', SERPER_API_KEY: 'serper-key' })
  })

  afterAll(resetEnvMock)

  it('passes the request registry through the Exa execution boundary', async () => {
    const registry = activeQueryRegistry()
    mockExecuteTool.mockResolvedValue({
      success: true,
      output: {
        results: [{ title: 'Result', url: 'https://example.com', highlights: ['Snippet'] }],
      },
    })

    await searchOnlineServerTool.execute(
      { query: 'private search query' },
      { userId: 'user-1', resolvedSecretTraceRegistry: registry }
    )

    expect(mockExecuteTool).toHaveBeenCalledWith(
      'exa_search',
      expect.objectContaining({ query: 'private search query' }),
      { resolvedSecretTraceRegistry: registry }
    )
  })

  it('passes the request registry through the Serper fallback boundary', async () => {
    const registry = activeQueryRegistry()
    mockExecuteTool
      .mockResolvedValueOnce({ success: true, output: { results: [] } })
      .mockResolvedValueOnce({
        success: true,
        output: {
          searchResults: [{ title: 'Result', link: 'https://example.com', snippet: 'Snippet' }],
        },
      })

    await searchOnlineServerTool.execute(
      { query: 'private search query' },
      { userId: 'user-1', resolvedSecretTraceRegistry: registry }
    )

    expect(mockExecuteTool).toHaveBeenNthCalledWith(
      2,
      'serper_search',
      expect.objectContaining({ query: 'private search query' }),
      { resolvedSecretTraceRegistry: registry }
    )
  })

  it('projects a provider error before logging the fallback', async () => {
    const registry = activeQueryRegistry()
    mockExecuteTool
      .mockRejectedValueOnce(new Error('Provider echoed private search query'))
      .mockResolvedValueOnce({ success: true, output: { searchResults: [] } })

    await searchOnlineServerTool.execute(
      { query: 'private search query' },
      { userId: 'user-1', resolvedSecretTraceRegistry: registry }
    )

    const logger = loggerMock.createLogger.mock.results.at(-1)?.value
    expect(JSON.stringify(logger?.warn.mock.calls)).toContain('{{SEARCH_QUERY}}')
    expect(JSON.stringify(logger?.warn.mock.calls)).not.toContain('private search query')
  })
})

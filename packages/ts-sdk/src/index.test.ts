import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SDK_VERSION, SimStudioClient } from './index'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function v2ExecutionResponse(output: unknown = {}, status = 'completed') {
  return {
    data: {
      runId: 'execution-123',
      workflowId: 'workflow-id',
      status,
      output,
      error: null,
      startedAt: '2026-08-11T12:00:00.000Z',
      endedAt: '2026-08-11T12:00:00.010Z',
      durationMs: 10,
    },
  }
}

describe('SimStudioClient', () => {
  let client: SimStudioClient

  beforeEach(() => {
    client = new SimStudioClient({
      apiKey: 'test-api-key',
      baseUrl: 'https://test.sim.ai',
    })
    vi.clearAllMocks()
  })

  describe('executeWorkflow - async execution', () => {
    it('throws when a sync workflow run completes with failed status', async () => {
      const failed = v2ExecutionResponse({ partial: true })
      failed.data.status = 'failed'
      failed.data.error = {
        code: 'BLOCK_EXECUTION_FAILED',
        message: 'Invalid credentials',
      }
      vi.mocked(mockFetch).mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(failed),
        headers: { get: vi.fn().mockReturnValue(null) },
      })

      await expect(client.executeWorkflow('workflow-id', {})).rejects.toMatchObject({
        name: 'SimStudioError',
        code: 'BLOCK_EXECUTION_FAILED',
        message: 'Invalid credentials',
      })
    })

    it('reports a cancelled sync run as unsuccessful', async () => {
      vi.mocked(mockFetch).mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(v2ExecutionResponse({}, 'cancelled')),
        headers: { get: vi.fn().mockReturnValue(null) },
      })

      const result = await client.executeWorkflow('workflow-id', {})

      expect(result).toHaveProperty('success', false)
    })

    it('rejects a server-side timeout for sync execution', async () => {
      await expect(
        client.executeWorkflow('workflow-id', {}, { executionTimeoutSeconds: 90 })
      ).rejects.toMatchObject({ code: 'INVALID_EXECUTION_TIMEOUT' })
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('rejects a server-side timeout above seven days', async () => {
      await expect(
        client.executeWorkflow(
          'workflow-id',
          {},
          {
            async: true,
            executionTimeoutSeconds: 604_801,
          }
        )
      ).rejects.toMatchObject({ code: 'INVALID_EXECUTION_TIMEOUT' })
      expect(mockFetch).not.toHaveBeenCalled()
    })
  })

  describe('executeWithRetry', () => {
    it('should retry on rate limit error', async () => {
      // First call returns 429, second call succeeds
      const rateLimitResponse = {
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        json: vi.fn().mockResolvedValue({
          error: 'Rate limit exceeded',
          code: 'RATE_LIMIT_EXCEEDED',
        }),
        headers: {
          get: vi.fn((header: string) => {
            if (header === 'retry-after') return '1'
            if (header === 'x-ratelimit-limit') return '100'
            if (header === 'x-ratelimit-remaining') return '0'
            if (header === 'x-ratelimit-reset') return String(Math.floor(Date.now() / 1000) + 60)
            return null
          }),
        },
      }

      const successResponse = {
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(v2ExecutionResponse({ result: 'success' })),
        headers: {
          get: vi.fn().mockReturnValue(null),
        },
      }

      vi.mocked(mockFetch)
        .mockResolvedValueOnce(rateLimitResponse as any)
        .mockResolvedValueOnce(successResponse as any)

      const result = await client.executeWithRetry(
        'workflow-id',
        { message: 'test' },
        {},
        { maxRetries: 3, initialDelay: 10 }
      )

      expect(result).toHaveProperty('success', true)
      expect(vi.mocked(mockFetch)).toHaveBeenCalledTimes(2)
    })

    it('should throw after max retries exceeded', async () => {
      const mockResponse = {
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        json: vi.fn().mockResolvedValue({
          error: 'Rate limit exceeded',
          code: 'RATE_LIMIT_EXCEEDED',
        }),
        headers: {
          get: vi.fn((header: string) => {
            if (header === 'retry-after') return '1'
            return null
          }),
        },
      }

      vi.mocked(mockFetch).mockResolvedValue(mockResponse as any)

      await expect(
        client.executeWithRetry(
          'workflow-id',
          { message: 'test' },
          {},
          { maxRetries: 2, initialDelay: 10 }
        )
      ).rejects.toThrow('Rate limit exceeded')

      expect(vi.mocked(mockFetch)).toHaveBeenCalledTimes(3) // Initial + 2 retries
    })

    it('should not retry on non-rate-limit errors', async () => {
      const mockResponse = {
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: vi.fn().mockResolvedValue({
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Server error',
          },
        }),
        headers: {
          get: vi.fn().mockReturnValue(null),
        },
      }

      vi.mocked(mockFetch).mockResolvedValue(mockResponse as any)

      await expect(client.executeWithRetry('workflow-id', { message: 'test' })).rejects.toThrow(
        'Server error'
      )

      expect(vi.mocked(mockFetch)).toHaveBeenCalledTimes(1) // No retries
    })
  })

  describe('getRateLimitInfo', () => {
    it('parses an ISO x-ratelimit-reset, the format the v2 API sends', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(v2ExecutionResponse()),
        headers: {
          get: vi.fn((header: string) => {
            if (header === 'x-ratelimit-limit') return '100'
            if (header === 'x-ratelimit-remaining') return '99'
            if (header === 'x-ratelimit-reset') return '2024-01-01T00:00:00.000Z'
            return null
          }),
        },
      }

      vi.mocked(mockFetch).mockResolvedValue(mockResponse as any)

      await client.executeWorkflow('workflow-id', {})

      expect(client.getRateLimitInfo()?.reset).toBe(1704067200000)
    })
  })
})

describe('client identity', () => {
  it('keeps SDK_VERSION in step with package.json', () => {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    expect(SDK_VERSION).toBe(manifest.version)
  })

  it('identifies the SDK on every request', async () => {
    const client = new SimStudioClient({ apiKey: 'test-api-key', baseUrl: 'https://test.sim.ai' })
    vi.mocked(mockFetch).mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ data: { isDeployed: true } }),
    } as any)

    await client.getWorkflowStatus('workflow-id')

    const headers = vi.mocked(mockFetch).mock.calls[0][1]?.headers as Record<string, string>
    expect(headers['X-Sim-Client-Info']).toBe(
      `sdk-js/${SDK_VERSION}; node/${process.versions.node}`
    )
    expect(headers['User-Agent']).toBe(
      `simstudio-ts-sdk/${SDK_VERSION} node/${process.versions.node}`
    )
    expect(headers['X-API-Key']).toBe('test-api-key')
  })
})

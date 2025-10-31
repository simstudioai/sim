import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SimStudioClient, SimStudioError } from './index'

vi.mock('node-fetch', () => ({
  default: vi.fn(),
}))

describe('SimStudioClient', () => {
  let client: SimStudioClient

  beforeEach(() => {
    client = new SimStudioClient({
      apiKey: 'test-api-key',
      baseUrl: 'https://test.sim.ai',
    })
    vi.clearAllMocks()
  })

  describe('constructor', () => {
    it('should create a client with correct configuration', () => {
      expect(client).toBeInstanceOf(SimStudioClient)
    })

    it('should use default base URL when not provided', () => {
      const defaultClient = new SimStudioClient({
        apiKey: 'test-api-key',
      })
      expect(defaultClient).toBeInstanceOf(SimStudioClient)
    })
  })

  describe('setApiKey', () => {
    it('should update the API key', () => {
      const newApiKey = 'new-api-key'
      client.setApiKey(newApiKey)

      // Verify the method exists
      expect(client.setApiKey).toBeDefined()
      // Verify the API key was actually updated
      expect((client as any).apiKey).toBe(newApiKey)
    })
  })

  describe('setBaseUrl', () => {
    it('should update the base URL', () => {
      const newBaseUrl = 'https://new.sim.ai'
      client.setBaseUrl(newBaseUrl)
      expect((client as any).baseUrl).toBe(newBaseUrl)
    })

    it('should strip trailing slash from base URL', () => {
      const urlWithSlash = 'https://test.sim.ai/'
      client.setBaseUrl(urlWithSlash)
      // Verify the trailing slash was actually stripped
      expect((client as any).baseUrl).toBe('https://test.sim.ai')
    })
  })

  describe('validateWorkflow', () => {
    it('should return false when workflow status request fails', async () => {
      const fetch = await import('node-fetch')
      vi.mocked(fetch.default).mockRejectedValue(new Error('Network error'))

      const result = await client.validateWorkflow('test-workflow-id')
      expect(result).toBe(false)
    })

    it('should return true when workflow is deployed', async () => {
      const fetch = await import('node-fetch')
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          isDeployed: true,
          deployedAt: '2023-01-01T00:00:00Z',
          needsRedeployment: false,
        }),
      }
      vi.mocked(fetch.default).mockResolvedValue(mockResponse as any)

      const result = await client.validateWorkflow('test-workflow-id')
      expect(result).toBe(true)
    })

    it('should return false when workflow is not deployed', async () => {
      const fetch = await import('node-fetch')
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          isDeployed: false,
          deployedAt: null,
          needsRedeployment: true,
        }),
      }
      vi.mocked(fetch.default).mockResolvedValue(mockResponse as any)

      const result = await client.validateWorkflow('test-workflow-id')
      expect(result).toBe(false)
    })
  })

  describe('executeWorkflow - async execution', () => {
    it('should return AsyncExecutionResult when async is true', async () => {
      const fetch = await import('node-fetch')
      const mockResponse = {
        ok: true,
        status: 202,
        json: vi.fn().mockResolvedValue({
          success: true,
          taskId: 'task-123',
          status: 'queued',
          createdAt: '2024-01-01T00:00:00Z',
          links: {
            status: '/api/jobs/task-123',
          },
        }),
        headers: {
          get: vi.fn().mockReturnValue(null),
        },
      }
      vi.mocked(fetch.default).mockResolvedValue(mockResponse as any)

      const result = await client.executeWorkflow('workflow-id', {
        input: { message: 'Hello' },
        async: true,
      })

      expect(result).toHaveProperty('taskId', 'task-123')
      expect(result).toHaveProperty('status', 'queued')
      expect(result).toHaveProperty('links')
      expect((result as any).links.status).toBe('/api/jobs/task-123')

      // Verify headers were set correctly
      const calls = vi.mocked(fetch.default).mock.calls
      expect(calls[0][1]?.headers).toMatchObject({
        'X-Execution-Mode': 'async',
      })
    })

    it('should return WorkflowExecutionResult when async is false', async () => {
      const fetch = await import('node-fetch')
      const mockResponse = {
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          success: true,
          output: { result: 'completed' },
          logs: [],
        }),
        headers: {
          get: vi.fn().mockReturnValue(null),
        },
      }
      vi.mocked(fetch.default).mockResolvedValue(mockResponse as any)

      const result = await client.executeWorkflow('workflow-id', {
        input: { message: 'Hello' },
        async: false,
      })

      expect(result).toHaveProperty('success', true)
      expect(result).toHaveProperty('output')
      expect(result).not.toHaveProperty('taskId')
    })

    it('should not set X-Execution-Mode header when async is undefined', async () => {
      const fetch = await import('node-fetch')
      const mockResponse = {
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          success: true,
          output: {},
        }),
        headers: {
          get: vi.fn().mockReturnValue(null),
        },
      }
      vi.mocked(fetch.default).mockResolvedValue(mockResponse as any)

      await client.executeWorkflow('workflow-id', {
        input: { message: 'Hello' },
      })

      const calls = vi.mocked(fetch.default).mock.calls
      expect(calls[0][1]?.headers).not.toHaveProperty('X-Execution-Mode')
    })
  })

  describe('getJobStatus', () => {
    it('should fetch job status with correct endpoint', async () => {
      const fetch = await import('node-fetch')
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          success: true,
          taskId: 'task-123',
          status: 'completed',
          metadata: {
            startedAt: '2024-01-01T00:00:00Z',
            completedAt: '2024-01-01T00:01:00Z',
            duration: 60000,
          },
          output: { result: 'done' },
        }),
        headers: {
          get: vi.fn().mockReturnValue(null),
        },
      }
      vi.mocked(fetch.default).mockResolvedValue(mockResponse as any)

      const result = await client.getJobStatus('task-123')

      expect(result).toHaveProperty('taskId', 'task-123')
      expect(result).toHaveProperty('status', 'completed')
      expect(result).toHaveProperty('output')

      // Verify correct endpoint was called
      const calls = vi.mocked(fetch.default).mock.calls
      expect(calls[0][0]).toBe('https://test.sim.ai/api/jobs/task-123')
    })

    it('should handle job not found error', async () => {
      const fetch = await import('node-fetch')
      const mockResponse = {
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: vi.fn().mockResolvedValue({
          error: 'Job not found',
          code: 'JOB_NOT_FOUND',
        }),
        headers: {
          get: vi.fn().mockReturnValue(null),
        },
      }
      vi.mocked(fetch.default).mockResolvedValue(mockResponse as any)

      await expect(client.getJobStatus('invalid-task')).rejects.toThrow(SimStudioError)
      await expect(client.getJobStatus('invalid-task')).rejects.toThrow('Job not found')
    })
  })

  describe('executeWithRetry', () => {
    it('should succeed on first attempt when no rate limit', async () => {
      const fetch = await import('node-fetch')
      const mockResponse = {
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          success: true,
          output: { result: 'success' },
        }),
        headers: {
          get: vi.fn().mockReturnValue(null),
        },
      }
      vi.mocked(fetch.default).mockResolvedValue(mockResponse as any)

      const result = await client.executeWithRetry('workflow-id', {
        input: { message: 'test' },
      })

      expect(result).toHaveProperty('success', true)
      expect(vi.mocked(fetch.default)).toHaveBeenCalledTimes(1)
    })

    it('should retry on rate limit error', async () => {
      const fetch = await import('node-fetch')

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
        json: vi.fn().mockResolvedValue({
          success: true,
          output: { result: 'success' },
        }),
        headers: {
          get: vi.fn().mockReturnValue(null),
        },
      }

      vi.mocked(fetch.default)
        .mockResolvedValueOnce(rateLimitResponse as any)
        .mockResolvedValueOnce(successResponse as any)

      const result = await client.executeWithRetry(
        'workflow-id',
        { input: { message: 'test' } },
        { maxRetries: 3, initialDelay: 10 }
      )

      expect(result).toHaveProperty('success', true)
      expect(vi.mocked(fetch.default)).toHaveBeenCalledTimes(2)
    })

    it('should throw after max retries exceeded', async () => {
      const fetch = await import('node-fetch')
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

      vi.mocked(fetch.default).mockResolvedValue(mockResponse as any)

      await expect(
        client.executeWithRetry(
          'workflow-id',
          { input: { message: 'test' } },
          { maxRetries: 2, initialDelay: 10 }
        )
      ).rejects.toThrow('Rate limit exceeded')

      expect(vi.mocked(fetch.default)).toHaveBeenCalledTimes(3) // Initial + 2 retries
    })

    it('should not retry on non-rate-limit errors', async () => {
      const fetch = await import('node-fetch')
      const mockResponse = {
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: vi.fn().mockResolvedValue({
          error: 'Server error',
          code: 'INTERNAL_ERROR',
        }),
        headers: {
          get: vi.fn().mockReturnValue(null),
        },
      }

      vi.mocked(fetch.default).mockResolvedValue(mockResponse as any)

      await expect(
        client.executeWithRetry('workflow-id', { input: { message: 'test' } })
      ).rejects.toThrow('Server error')

      expect(vi.mocked(fetch.default)).toHaveBeenCalledTimes(1) // No retries
    })
  })

  describe('getRateLimitInfo', () => {
    it('should return null when no rate limit info available', () => {
      const info = client.getRateLimitInfo()
      expect(info).toBeNull()
    })

    it('should return rate limit info after API call', async () => {
      const fetch = await import('node-fetch')
      const mockResponse = {
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ success: true, output: {} }),
        headers: {
          get: vi.fn((header: string) => {
            if (header === 'x-ratelimit-limit') return '100'
            if (header === 'x-ratelimit-remaining') return '95'
            if (header === 'x-ratelimit-reset') return '1704067200'
            return null
          }),
        },
      }

      vi.mocked(fetch.default).mockResolvedValue(mockResponse as any)

      await client.executeWorkflow('workflow-id', { input: {} })

      const info = client.getRateLimitInfo()
      expect(info).not.toBeNull()
      expect(info?.limit).toBe(100)
      expect(info?.remaining).toBe(95)
      expect(info?.reset).toBe(1704067200)
    })
  })

  describe('getUsageLimits', () => {
    it('should fetch usage limits with correct structure', async () => {
      const fetch = await import('node-fetch')
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          success: true,
          rateLimit: {
            sync: {
              isLimited: false,
              limit: 100,
              remaining: 95,
              resetAt: '2024-01-01T01:00:00Z',
            },
            async: {
              isLimited: false,
              limit: 50,
              remaining: 48,
              resetAt: '2024-01-01T01:00:00Z',
            },
            authType: 'api',
          },
          usage: {
            currentPeriodCost: 1.23,
            limit: 100.0,
            plan: 'pro',
          },
        }),
        headers: {
          get: vi.fn().mockReturnValue(null),
        },
      }

      vi.mocked(fetch.default).mockResolvedValue(mockResponse as any)

      const result = await client.getUsageLimits()

      expect(result.success).toBe(true)
      expect(result.rateLimit.sync.limit).toBe(100)
      expect(result.rateLimit.async.limit).toBe(50)
      expect(result.usage.currentPeriodCost).toBe(1.23)
      expect(result.usage.plan).toBe('pro')

      // Verify correct endpoint was called
      const calls = vi.mocked(fetch.default).mock.calls
      expect(calls[0][0]).toBe('https://test.sim.ai/api/users/me/usage-limits')
    })

    it('should handle unauthorized error', async () => {
      const fetch = await import('node-fetch')
      const mockResponse = {
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: vi.fn().mockResolvedValue({
          error: 'Invalid API key',
          code: 'UNAUTHORIZED',
        }),
        headers: {
          get: vi.fn().mockReturnValue(null),
        },
      }

      vi.mocked(fetch.default).mockResolvedValue(mockResponse as any)

      await expect(client.getUsageLimits()).rejects.toThrow(SimStudioError)
      await expect(client.getUsageLimits()).rejects.toThrow('Invalid API key')
    })
  })

  describe('executeWorkflow - streaming with selectedOutputs', () => {
    it('should include stream and selectedOutputs in request body', async () => {
      const fetch = await import('node-fetch')
      const mockResponse = {
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          success: true,
          output: {},
        }),
        headers: {
          get: vi.fn().mockReturnValue(null),
        },
      }

      vi.mocked(fetch.default).mockResolvedValue(mockResponse as any)

      await client.executeWorkflow('workflow-id', {
        input: { message: 'test' },
        stream: true,
        selectedOutputs: ['agent1.content', 'agent2.content'],
      })

      const calls = vi.mocked(fetch.default).mock.calls
      const requestBody = JSON.parse(calls[0][1]?.body as string)

      expect(requestBody).toHaveProperty('message', 'test')
      expect(requestBody).toHaveProperty('stream', true)
      expect(requestBody).toHaveProperty('selectedOutputs')
      expect(requestBody.selectedOutputs).toEqual(['agent1.content', 'agent2.content'])
    })
  })
})

describe('SimStudioError', () => {
  it('should create error with message', () => {
    const error = new SimStudioError('Test error')
    expect(error.message).toBe('Test error')
    expect(error.name).toBe('SimStudioError')
  })

  it('should create error with code and status', () => {
    const error = new SimStudioError('Test error', 'TEST_CODE', 400)
    expect(error.message).toBe('Test error')
    expect(error.code).toBe('TEST_CODE')
    expect(error.status).toBe(400)
  })
})

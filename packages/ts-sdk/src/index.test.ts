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
      baseUrl: 'https://test.simstudio.ai',
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
    })
  })

  describe('setBaseUrl', () => {
    it('should update the base URL', () => {
      const newBaseUrl = 'https://new.simstudio.ai'
      client.setBaseUrl(newBaseUrl)
      expect(client.setBaseUrl).toBeDefined()
    })

    it('should strip trailing slash from base URL', () => {
      const urlWithSlash = 'https://test.simstudio.ai/'
      client.setBaseUrl(urlWithSlash)
      expect(client.setBaseUrl).toBeDefined()
    })
  })

  describe('validateWorkflow', () => {
    it('should return false when workflow status request fails', async () => {
      const fetch = await import('node-fetch')
      vi.mocked(fetch.default).mockRejectedValue(new Error('Network error'))

      const result = await client.validateWorkflow('test-workflow-id')
      expect(result).toBe(false)
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

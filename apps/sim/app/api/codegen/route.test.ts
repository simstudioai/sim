/**
 * Tests for codegen API route
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockRequest } from '@/app/api/__test-utils__/utils'

describe('Codegen API Route', () => {
  const mockOpenAI = {
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
  }
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }
  const mockEnv = {
    OPENAI_API_KEY: 'test-api-key',
  }

  const mockUUID = 'mock-uuid-12345678-90ab-cdef-1234-567890abcdef'

  beforeEach(() => {
    vi.resetModules()
    mockEnv.OPENAI_API_KEY = 'test-api-key'

    vi.stubGlobal('crypto', {
      randomUUID: vi.fn().mockReturnValue(mockUUID),
    })

    const MockAPIError = class extends Error {
      status: number
      constructor(message: string, status?: number) {
        super(message)
        this.status = status || 500
      }
    }

    vi.doMock('openai', () => ({
      default: vi.fn().mockImplementation(() => mockOpenAI),
      APIError: MockAPIError,
    }))

    vi.doMock('@/lib/env', () => ({
      env: mockEnv,
    }))

    vi.doMock('@/lib/logs/console-logger', () => ({
      createLogger: vi.fn().mockReturnValue(mockLogger),
    }))

    vi.doMock('next/cache', () => ({
      unstable_noStore: vi.fn(),
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should generate JSON schema successfully', async () => {
    const mockResponse = {
      choices: [
        {
          message: {
            content: JSON.stringify({
              name: 'test_function',
              description: 'A test function',
              strict: true,
              schema: {
                type: 'object',
                properties: {
                  input: { type: 'string', description: 'Test input' },
                },
                additionalProperties: false,
                required: ['input'],
              },
            }),
          },
        },
      ],
    }

    mockOpenAI.chat.completions.create.mockResolvedValueOnce(mockResponse)

    const req = createMockRequest('POST', {
      prompt: 'Create a function that takes a string input',
      generationType: 'json-schema',
    })

    const { POST } = await import('./route')

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.generatedContent).toBeDefined()
    expect(() => JSON.parse(data.generatedContent)).not.toThrow()
    expect(mockOpenAI.chat.completions.create).toHaveBeenCalledWith({
      model: 'gpt-4o',
      messages: expect.arrayContaining([
        expect.objectContaining({ role: 'system' }),
        expect.objectContaining({
          role: 'user',
          content: 'Create a function that takes a string input',
        }),
      ]),
      temperature: 0.2,
      max_tokens: 1500,
      response_format: { type: 'json_object' },
    })
  })

  it('should generate JavaScript function body successfully', async () => {
    const mockResponse = {
      choices: [
        {
          message: {
            content: 'const input = <input>;\nreturn input.toUpperCase();',
          },
        },
      ],
    }

    mockOpenAI.chat.completions.create.mockResolvedValueOnce(mockResponse)

    const req = createMockRequest('POST', {
      prompt: 'Convert input to uppercase',
      generationType: 'javascript-function-body',
    })

    const { POST } = await import('./route')

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.generatedContent).toBe('const input = <input>;\nreturn input.toUpperCase();')
    expect(mockOpenAI.chat.completions.create).toHaveBeenCalledWith({
      model: 'gpt-4o',
      messages: expect.arrayContaining([
        expect.objectContaining({ role: 'system' }),
        expect.objectContaining({ role: 'user' }),
      ]),
      temperature: 0.2,
      max_tokens: 1500,
      response_format: undefined,
    })
  })

  it('should generate custom tool schema successfully', async () => {
    const mockResponse = {
      choices: [
        {
          message: {
            content: JSON.stringify({
              type: 'function',
              function: {
                name: 'testFunction',
                description: 'A test function',
                parameters: {
                  type: 'object',
                  properties: {
                    input: { type: 'string', description: 'Test input' },
                  },
                  required: ['input'],
                  additionalProperties: false,
                },
              },
            }),
          },
        },
      ],
    }

    mockOpenAI.chat.completions.create.mockResolvedValueOnce(mockResponse)

    const req = createMockRequest('POST', {
      prompt: 'Create a custom tool for testing',
      generationType: 'custom-tool-schema',
    })

    const { POST } = await import('./route')

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.generatedContent).toBeDefined()
  })

  it('should include context in the prompt', async () => {
    const mockResponse = {
      choices: [
        {
          message: {
            content: 'const result = <input>;\nreturn result;',
          },
        },
      ],
    }

    mockOpenAI.chat.completions.create.mockResolvedValueOnce(mockResponse)

    const req = createMockRequest('POST', {
      prompt: 'Modify this function',
      generationType: 'javascript-function-body',
      context: 'existing function code here',
    })

    const { POST } = await import('./route')

    const response = await POST(req)

    expect(response.status).toBe(200)
    expect(mockOpenAI.chat.completions.create).toHaveBeenCalledWith({
      model: 'gpt-4o',
      messages: expect.arrayContaining([
        expect.objectContaining({ role: 'system' }),
        expect.objectContaining({
          role: 'user',
          content:
            'Prompt: Modify this function\\n\\nExisting Content/Context:\\nexisting function code here',
        }),
      ]),
      temperature: 0.2,
      max_tokens: 1500,
      response_format: undefined,
    })
  })

  it('should include conversation history', async () => {
    const mockResponse = {
      choices: [
        {
          message: {
            content: 'Updated function code',
          },
        },
      ],
    }

    mockOpenAI.chat.completions.create.mockResolvedValueOnce(mockResponse)

    const req = createMockRequest('POST', {
      prompt: 'Update the function',
      generationType: 'javascript-function-body',
      history: [
        { role: 'user', content: 'Create a function' },
        { role: 'assistant', content: 'function created' },
      ],
    })

    const { POST } = await import('./route')

    const response = await POST(req)

    expect(response.status).toBe(200)
    expect(mockOpenAI.chat.completions.create).toHaveBeenCalledWith({
      model: 'gpt-4o',
      messages: expect.arrayContaining([
        expect.objectContaining({ role: 'system' }),
        expect.objectContaining({ role: 'user', content: 'Create a function' }),
        expect.objectContaining({ role: 'assistant', content: 'function created' }),
        expect.objectContaining({ role: 'user', content: 'Update the function' }),
      ]),
      temperature: 0.2,
      max_tokens: 1500,
      response_format: undefined,
    })
  })

  it('should handle missing OpenAI API key', async () => {
    mockEnv.OPENAI_API_KEY = ''

    const req = createMockRequest('POST', {
      prompt: 'Test prompt',
      generationType: 'json-schema',
    })

    const { POST } = await import('./route')

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(503)
    expect(data.success).toBe(false)
    expect(data.error).toBe('Code generation service is not configured.')
  })

  it('should handle missing required fields', async () => {
    const req = createMockRequest('POST', {
      prompt: '',
    })

    const { POST } = await import('./route')

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.success).toBe(false)
    expect(data.error).toBe('Missing required fields: prompt and generationType.')
    expect(mockLogger.warn).toHaveBeenCalled()
  })

  it('should handle invalid generation type', async () => {
    const req = createMockRequest('POST', {
      prompt: 'Test prompt',
      generationType: 'invalid-type',
    })

    const { POST } = await import('./route')

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.success).toBe(false)
    expect(data.error).toBe('Invalid generationType: invalid-type')
    expect(mockLogger.warn).toHaveBeenCalled()
  })

  it('should handle empty OpenAI response', async () => {
    const mockResponse = {
      choices: [
        {
          message: {
            content: null,
          },
        },
      ],
    }

    mockOpenAI.chat.completions.create.mockResolvedValueOnce(mockResponse)

    const req = createMockRequest('POST', {
      prompt: 'Test prompt',
      generationType: 'javascript-function-body',
    })

    const { POST } = await import('./route')

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.success).toBe(false)
    expect(data.error).toBe('Failed to generate content. OpenAI response was empty.')
    expect(mockLogger.error).toHaveBeenCalled()
  })

  it('should handle invalid JSON schema generation', async () => {
    const mockResponse = {
      choices: [
        {
          message: {
            content: 'invalid json content',
          },
        },
      ],
    }

    mockOpenAI.chat.completions.create.mockResolvedValueOnce(mockResponse)

    const req = createMockRequest('POST', {
      prompt: 'Create a schema',
      generationType: 'json-schema',
    })

    const { POST } = await import('./route')

    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.success).toBe(false)
    expect(data.error).toBe('Generated JSON schema was invalid.')
    expect(mockLogger.error).toHaveBeenCalled()
  })
})

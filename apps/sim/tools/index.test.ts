/**
 * @vitest-environment jsdom
 *
 * Tools Registry and Executor Unit Tests
 *
 * This file contains unit tests for the tools registry and executeTool function,
 * which are the central pieces of infrastructure for executing tools.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionContext } from '@/executor/types'
import { mockEnvironmentVariables } from '@/tools/__test-utils__/test-tools'
import { executeTool } from '@/tools/index'
import { tools } from '@/tools/registry'
import { getTool } from '@/tools/utils'

// Helper function to create mock ExecutionContext
const createMockExecutionContext = (overrides?: Partial<ExecutionContext>): ExecutionContext => ({
  workflowId: 'test-workflow',
  workspaceId: 'workspace-456',
  blockStates: new Map(),
  blockLogs: [],
  metadata: { startTime: new Date().toISOString(), duration: 0 },
  environmentVariables: {},
  decisions: { router: new Map(), condition: new Map() },
  loopIterations: new Map(),
  loopItems: new Map(),
  completedLoops: new Set(),
  executedBlocks: new Set(),
  activeExecutionPath: new Set(),
  ...overrides,
})

describe('Tools Registry', () => {
  it.concurrent('should include all expected built-in tools', () => {
    expect(Object.keys(tools).length).toBeGreaterThan(10)

    // Check for existence of some core tools
    expect(tools.http_request).toBeDefined()
    expect(tools.function_execute).toBeDefined()

    // Check for some integrations
    expect(tools.gmail_read).toBeDefined()
    expect(tools.gmail_send).toBeDefined()
    expect(tools.google_drive_list).toBeDefined()
    expect(tools.serper_search).toBeDefined()
  })

  it.concurrent('getTool should return the correct tool by ID', () => {
    const httpTool = getTool('http_request')
    expect(httpTool).toBeDefined()
    expect(httpTool?.id).toBe('http_request')
    expect(httpTool?.name).toBe('HTTP Request')

    const gmailTool = getTool('gmail_read')
    expect(gmailTool).toBeDefined()
    expect(gmailTool?.id).toBe('gmail_read')
    expect(gmailTool?.name).toBe('Gmail Read')
  })

  it.concurrent('getTool should return undefined for non-existent tool', () => {
    const nonExistentTool = getTool('non_existent_tool')
    expect(nonExistentTool).toBeUndefined()
  })
})

describe('Custom Tools', () => {
  beforeEach(() => {
    // Mock custom tools store
    vi.mock('@/stores/custom-tools/store', () => ({
      useCustomToolsStore: {
        getState: () => ({
          getTool: (id: string) => {
            if (id === 'custom-tool-123') {
              return {
                id: 'custom-tool-123',
                title: 'Custom Weather Tool',
                code: 'return { result: "Weather data" }',
                schema: {
                  function: {
                    description: 'Get weather information',
                    parameters: {
                      type: 'object',
                      properties: {
                        location: { type: 'string', description: 'City name' },
                        unit: { type: 'string', description: 'Unit (metric/imperial)' },
                      },
                      required: ['location'],
                    },
                  },
                },
              }
            }
            return undefined
          },
          getAllTools: () => [
            {
              id: 'custom-tool-123',
              title: 'Custom Weather Tool',
              code: 'return { result: "Weather data" }',
              schema: {
                function: {
                  description: 'Get weather information',
                  parameters: {
                    type: 'object',
                    properties: {
                      location: { type: 'string', description: 'City name' },
                      unit: { type: 'string', description: 'Unit (metric/imperial)' },
                    },
                    required: ['location'],
                  },
                },
              },
            },
          ],
        }),
      },
    }))

    // Mock environment store
    vi.mock('@/stores/settings/environment/store', () => ({
      useEnvironmentStore: {
        getState: () => ({
          getAllVariables: () => ({
            API_KEY: { value: 'test-api-key' },
            BASE_URL: { value: 'https://test-base-url.com' },
          }),
        }),
      },
    }))
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  it.concurrent('should get custom tool by ID', () => {
    const customTool = getTool('custom_custom-tool-123')
    expect(customTool).toBeDefined()
    expect(customTool?.name).toBe('Custom Weather Tool')
    expect(customTool?.description).toBe('Get weather information')
    expect(customTool?.params.location).toBeDefined()
    expect(customTool?.params.location.required).toBe(true)
  })

  it.concurrent('should handle non-existent custom tool', () => {
    const nonExistentTool = getTool('custom_non-existent')
    expect(nonExistentTool).toBeUndefined()
  })
})

describe('executeTool Function', () => {
  let cleanupEnvVars: () => void

  beforeEach(() => {
    // Mock fetch
    global.fetch = Object.assign(
      vi.fn().mockImplementation(async (url, options) => {
        const mockResponse = {
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              success: true,
              output: { result: 'Direct request successful' },
            }),
          headers: {
            get: () => 'application/json',
            forEach: () => {},
          },
          clone: function () {
            return { ...this }
          },
        }

        if (url.toString().includes('/api/proxy')) {
          return mockResponse
        }

        return mockResponse
      }),
      { preconnect: vi.fn() }
    ) as typeof fetch

    // Set environment variables
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
    cleanupEnvVars = mockEnvironmentVariables({
      NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
    })
  })

  afterEach(() => {
    vi.resetAllMocks()
    cleanupEnvVars()
  })

  it.concurrent('should execute a tool successfully', async () => {
    const result = await executeTool(
      'http_request',
      {
        url: 'https://api.example.com/data',
        method: 'GET',
      },
      true
    ) // Skip proxy

    expect(result.success).toBe(true)
    expect(result.output).toBeDefined()
    expect(result.timing).toBeDefined()
    expect(result.timing?.startTime).toBeDefined()
    expect(result.timing?.endTime).toBeDefined()
    expect(result.timing?.duration).toBeGreaterThanOrEqual(0)
  })

  it('should call internal routes directly', async () => {
    // Mock transformResponse for function_execute tool
    const originalFunctionTool = { ...tools.function_execute }
    tools.function_execute = {
      ...tools.function_execute,
      transformResponse: vi.fn().mockResolvedValue({
        success: true,
        output: { result: 'Function executed successfully' },
      }),
    }

    await executeTool(
      'function_execute',
      {
        code: 'return { result: "hello world" }',
        language: 'javascript',
      },
      true
    ) // Skip proxy

    // Restore original tool
    tools.function_execute = originalFunctionTool

    // Expect transform response to have been called
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/function/execute'),
      expect.anything()
    )
  })

  it.concurrent('should handle non-existent tool', async () => {
    // Create the mock with a matching implementation
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await executeTool('non_existent_tool', {})

    // Expect failure
    expect(result.success).toBe(false)
    expect(result.error).toContain('Tool not found')

    vi.restoreAllMocks()
  })

  it.concurrent('should handle errors from tools', async () => {
    // Mock a failed response
    global.fetch = Object.assign(
      vi.fn().mockImplementation(async () => {
        return {
          ok: false,
          status: 400,
          json: () =>
            Promise.resolve({
              error: 'Bad request',
            }),
        }
      }),
      { preconnect: vi.fn() }
    ) as typeof fetch

    const result = await executeTool(
      'http_request',
      {
        url: 'https://api.example.com/data',
        method: 'GET',
      },
      true
    )

    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
    expect(result.timing).toBeDefined()
  })

  it.concurrent('should add timing information to results', async () => {
    const result = await executeTool(
      'http_request',
      {
        url: 'https://api.example.com/data',
      },
      true
    )

    expect(result.timing).toBeDefined()
    expect(result.timing?.startTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    expect(result.timing?.endTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    expect(result.timing?.duration).toBeGreaterThanOrEqual(0)
  })
})

describe('Automatic Internal Route Detection', () => {
  let cleanupEnvVars: () => void

  beforeEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
    cleanupEnvVars = mockEnvironmentVariables({
      NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
    })
  })

  afterEach(() => {
    vi.resetAllMocks()
    cleanupEnvVars()
  })

  it.concurrent(
    'should detect internal routes (URLs starting with /api/) and call them directly',
    async () => {
      // Mock a tool with an internal route
      const mockTool = {
        id: 'test_internal_tool',
        name: 'Test Internal Tool',
        description: 'A test tool with internal route',
        version: '1.0.0',
        params: {},
        request: {
          url: '/api/test/endpoint',
          method: 'POST',
          headers: () => ({ 'Content-Type': 'application/json' }),
        },
        transformResponse: vi.fn().mockResolvedValue({
          success: true,
          output: { result: 'Internal route success' },
        }),
      }

      // Mock the tool registry to include our test tool
      const originalTools = { ...tools }
      ;(tools as any).test_internal_tool = mockTool

      // Mock fetch for the internal API call
      global.fetch = Object.assign(
        vi.fn().mockImplementation(async (url) => {
          // Should call the internal API directly, not the proxy
          expect(url).toBe('http://localhost:3000/api/test/endpoint')
          return {
            ok: true,
            status: 200,
            json: () => Promise.resolve({ success: true, data: 'test' }),
            clone: vi.fn().mockReturnThis(),
          }
        }),
        { preconnect: vi.fn() }
      ) as typeof fetch

      const result = await executeTool('test_internal_tool', {}, false)

      expect(result.success).toBe(true)
      expect(result.output.result).toBe('Internal route success')
      expect(mockTool.transformResponse).toHaveBeenCalled()

      // Restore original tools
      Object.assign(tools, originalTools)
    }
  )

  it.concurrent('should detect external routes (full URLs) and use proxy', async () => {
    // Mock a tool with an external route
    const mockTool = {
      id: 'test_external_tool',
      name: 'Test External Tool',
      description: 'A test tool with external route',
      version: '1.0.0',
      params: {},
      request: {
        url: 'https://api.example.com/endpoint',
        method: 'GET',
        headers: () => ({ 'Content-Type': 'application/json' }),
      },
    }

    // Mock the tool registry to include our test tool
    const originalTools = { ...tools }
    ;(tools as any).test_external_tool = mockTool

    // Mock fetch for the proxy call
    global.fetch = Object.assign(
      vi.fn().mockImplementation(async (url) => {
        // Should call the proxy, not the external API directly
        expect(url).toBe('http://localhost:3000/api/proxy')
        return {
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              success: true,
              output: { result: 'External route via proxy' },
            }),
        }
      }),
      { preconnect: vi.fn() }
    ) as typeof fetch

    const result = await executeTool('test_external_tool', {}, false)

    expect(result.success).toBe(true)
    expect(result.output.result).toBe('External route via proxy')

    // Restore original tools
    Object.assign(tools, originalTools)
  })

  it.concurrent('should handle dynamic URLs that resolve to internal routes', async () => {
    // Mock a tool with a dynamic URL function that returns internal route
    const mockTool = {
      id: 'test_dynamic_internal',
      name: 'Test Dynamic Internal Tool',
      description: 'A test tool with dynamic internal route',
      version: '1.0.0',
      params: {
        resourceId: { type: 'string', required: true },
      },
      request: {
        url: (params: any) => `/api/resources/${params.resourceId}`,
        method: 'GET',
        headers: () => ({ 'Content-Type': 'application/json' }),
      },
      transformResponse: vi.fn().mockResolvedValue({
        success: true,
        output: { result: 'Dynamic internal route success' },
      }),
    }

    // Mock the tool registry to include our test tool
    const originalTools = { ...tools }
    ;(tools as any).test_dynamic_internal = mockTool

    // Mock fetch for the internal API call
    global.fetch = Object.assign(
      vi.fn().mockImplementation(async (url) => {
        // Should call the internal API directly with the resolved dynamic URL
        expect(url).toBe('http://localhost:3000/api/resources/123')
        return {
          ok: true,
          status: 200,
          json: () => Promise.resolve({ success: true, data: 'test' }),
          clone: vi.fn().mockReturnThis(),
        }
      }),
      { preconnect: vi.fn() }
    ) as typeof fetch

    const result = await executeTool('test_dynamic_internal', { resourceId: '123' }, false)

    expect(result.success).toBe(true)
    expect(result.output.result).toBe('Dynamic internal route success')
    expect(mockTool.transformResponse).toHaveBeenCalled()

    Object.assign(tools, originalTools)
  })

  it.concurrent('should handle dynamic URLs that resolve to external routes', async () => {
    // Mock a tool with a dynamic URL function that returns external route
    const mockTool = {
      id: 'test_dynamic_external',
      name: 'Test Dynamic External Tool',
      description: 'A test tool with dynamic external route',
      version: '1.0.0',
      params: {
        endpoint: { type: 'string', required: true },
      },
      request: {
        url: (params: any) => `https://api.external.com/${params.endpoint}`,
        method: 'GET',
        headers: () => ({ 'Content-Type': 'application/json' }),
      },
    }

    // Mock the tool registry to include our test tool
    const originalTools = { ...tools }
    ;(tools as any).test_dynamic_external = mockTool

    // Mock fetch for the proxy call
    global.fetch = Object.assign(
      vi.fn().mockImplementation(async (url) => {
        // Should call the proxy, not the external API directly
        expect(url).toBe('http://localhost:3000/api/proxy')
        return {
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              success: true,
              output: { result: 'Dynamic external route via proxy' },
            }),
        }
      }),
      { preconnect: vi.fn() }
    ) as typeof fetch

    const result = await executeTool('test_dynamic_external', { endpoint: 'users' }, false)

    expect(result.success).toBe(true)
    expect(result.output.result).toBe('Dynamic external route via proxy')

    // Restore original tools
    Object.assign(tools, originalTools)
  })

  it.concurrent(
    'should respect skipProxy parameter and call internal routes directly even for external URLs',
    async () => {
      const mockTool = {
        id: 'test_skip_proxy',
        name: 'Test Skip Proxy Tool',
        description: 'A test tool to verify skipProxy behavior',
        version: '1.0.0',
        params: {},
        request: {
          url: 'https://api.example.com/endpoint',
          method: 'GET',
          headers: () => ({ 'Content-Type': 'application/json' }),
        },
        transformResponse: vi.fn().mockResolvedValue({
          success: true,
          output: { result: 'Skipped proxy, called directly' },
        }),
      }

      const originalTools = { ...tools }
      ;(tools as any).test_skip_proxy = mockTool

      global.fetch = Object.assign(
        vi.fn().mockImplementation(async (url) => {
          expect(url).toBe('https://api.example.com/endpoint')
          return {
            ok: true,
            status: 200,
            json: () => Promise.resolve({ success: true, data: 'test' }),
            clone: vi.fn().mockReturnThis(),
          }
        }),
        { preconnect: vi.fn() }
      ) as typeof fetch

      const result = await executeTool('test_skip_proxy', {}, true) // skipProxy = true

      expect(result.success).toBe(true)
      expect(result.output.result).toBe('Skipped proxy, called directly')
      expect(mockTool.transformResponse).toHaveBeenCalled()

      Object.assign(tools, originalTools)
    }
  )
})

describe('Centralized Error Handling', () => {
  let cleanupEnvVars: () => void

  beforeEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
    cleanupEnvVars = mockEnvironmentVariables({
      NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
    })
  })

  afterEach(() => {
    vi.resetAllMocks()
    cleanupEnvVars()
  })

  const testErrorFormat = async (name: string, errorResponse: any, expectedError: string) => {
    global.fetch = Object.assign(
      vi.fn().mockImplementation(async () => ({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        headers: {
          get: (key: string) => (key === 'content-type' ? 'application/json' : null),
          forEach: (callback: (value: string, key: string) => void) => {
            callback('application/json', 'content-type')
          },
        },
        text: () => Promise.resolve(JSON.stringify(errorResponse)),
        json: () => Promise.resolve(errorResponse),
        clone: vi.fn().mockReturnThis(),
      })),
      { preconnect: vi.fn() }
    ) as typeof fetch

    const result = await executeTool(
      'function_execute',
      { code: 'return { result: "test" }' },
      true
    )

    expect(result.success).toBe(false)
    expect(result.error).toBe(expectedError)
  }

  it.concurrent('should extract GraphQL error format (Linear API)', async () => {
    await testErrorFormat(
      'GraphQL',
      { errors: [{ message: 'Invalid query field' }] },
      'Invalid query field'
    )
  })

  it.concurrent('should extract X/Twitter API error format', async () => {
    await testErrorFormat(
      'X/Twitter',
      { errors: [{ detail: 'Rate limit exceeded' }] },
      'Rate limit exceeded'
    )
  })

  it.concurrent('should extract Hunter API error format', async () => {
    await testErrorFormat('Hunter', { errors: [{ details: 'Invalid API key' }] }, 'Invalid API key')
  })

  it.concurrent('should extract direct errors array (string)', async () => {
    await testErrorFormat('Direct string array', { errors: ['Network timeout'] }, 'Network timeout')
  })

  it.concurrent('should extract direct errors array (object)', async () => {
    await testErrorFormat(
      'Direct object array',
      { errors: [{ message: 'Validation failed' }] },
      'Validation failed'
    )
  })

  it.concurrent('should extract OAuth error description', async () => {
    await testErrorFormat('OAuth', { error_description: 'Invalid grant' }, 'Invalid grant')
  })

  it.concurrent('should extract SOAP fault error', async () => {
    await testErrorFormat(
      'SOAP fault',
      { fault: { faultstring: 'Server unavailable' } },
      'Server unavailable'
    )
  })

  it.concurrent('should extract simple SOAP faultstring', async () => {
    await testErrorFormat(
      'Simple SOAP',
      { faultstring: 'Authentication failed' },
      'Authentication failed'
    )
  })

  it.concurrent('should extract Notion/Discord message format', async () => {
    await testErrorFormat('Notion/Discord', { message: 'Page not found' }, 'Page not found')
  })

  it.concurrent('should extract Airtable error object format', async () => {
    await testErrorFormat(
      'Airtable',
      { error: { message: 'Invalid table ID' } },
      'Invalid table ID'
    )
  })

  it.concurrent('should extract simple error string format', async () => {
    await testErrorFormat(
      'Simple string',
      { error: 'Simple error message' },
      'Simple error message'
    )
  })

  it.concurrent('should fall back to HTTP status when JSON parsing fails', async () => {
    global.fetch = Object.assign(
      vi.fn().mockImplementation(async () => ({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        headers: {
          get: (key: string) => (key === 'content-type' ? 'text/plain' : null),
          forEach: (callback: (value: string, key: string) => void) => {
            callback('text/plain', 'content-type')
          },
        },
        text: () => Promise.resolve('Invalid JSON response'),
        json: () => Promise.reject(new Error('Invalid JSON')),
        clone: vi.fn().mockReturnThis(),
      })),
      { preconnect: vi.fn() }
    ) as typeof fetch

    const result = await executeTool(
      'function_execute',
      { code: 'return { result: "test" }' },
      true
    )

    expect(result.success).toBe(false)
    expect(result.error).toBe('Failed to parse response from function_execute: Error: Invalid JSON')
  })

  it.concurrent('should handle complex nested error objects', async () => {
    await testErrorFormat(
      'Complex nested',
      { error: { code: 400, message: 'Complex validation error', details: 'Field X is invalid' } },
      'Complex validation error'
    )
  })

  it.concurrent('should handle error arrays with multiple entries (take first)', async () => {
    await testErrorFormat(
      'Multiple errors',
      { errors: [{ message: 'First error' }, { message: 'Second error' }] },
      'First error'
    )
  })

  it.concurrent('should stringify complex error objects when no message found', async () => {
    const complexError = { code: 500, type: 'ServerError', context: { requestId: '123' } }
    await testErrorFormat(
      'Complex object stringify',
      { error: complexError },
      JSON.stringify(complexError)
    )
  })
})

describe('MCP Tool Execution', () => {
  let cleanupEnvVars: () => void

  beforeEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
    cleanupEnvVars = mockEnvironmentVariables({
      NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
    })
  })

  afterEach(() => {
    vi.resetAllMocks()
    cleanupEnvVars()
  })

  it.concurrent('should execute MCP tool with valid tool ID', async () => {
    global.fetch = Object.assign(
      vi.fn().mockImplementation(async (url, options) => {
        expect(url).toBe('http://localhost:3000/api/mcp/tools/execute')
        expect(options?.method).toBe('POST')

        const body = JSON.parse(options?.body as string)
        expect(body.serverId).toBe('mcp-123')
        expect(body.toolName).toBe('list_files')
        expect(body.arguments).toEqual({ path: '/test' })
        expect(body.workspaceId).toBe('workspace-456')

        return {
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              success: true,
              data: {
                output: {
                  content: [{ type: 'text', text: 'Files listed successfully' }],
                },
              },
            }),
        }
      }),
      { preconnect: vi.fn() }
    ) as typeof fetch

    const mockContext = createMockExecutionContext()

    const result = await executeTool(
      'mcp-123-list_files',
      { path: '/test' },
      false,
      false,
      mockContext
    )

    expect(result.success).toBe(true)
    expect(result.output).toBeDefined()
    expect(result.output.content).toBeDefined()
    expect(result.timing).toBeDefined()
  })

  it.concurrent('should handle MCP tool ID parsing correctly', async () => {
    global.fetch = Object.assign(
      vi.fn().mockImplementation(async (url, options) => {
        const body = JSON.parse(options?.body as string)
        expect(body.serverId).toBe('mcp-timestamp123')
        expect(body.toolName).toBe('complex-tool-name')

        return {
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              success: true,
              data: { output: { content: [{ type: 'text', text: 'Success' }] } },
            }),
        }
      }),
      { preconnect: vi.fn() }
    ) as typeof fetch

    const mockContext2 = createMockExecutionContext()

    await executeTool(
      'mcp-timestamp123-complex-tool-name',
      { param: 'value' },
      false,
      false,
      mockContext2
    )
  })

  it.concurrent('should handle MCP block arguments format', async () => {
    global.fetch = Object.assign(
      vi.fn().mockImplementation(async (url, options) => {
        const body = JSON.parse(options?.body as string)
        expect(body.arguments).toEqual({ file: 'test.txt', mode: 'read' })

        return {
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              success: true,
              data: { output: { content: [{ type: 'text', text: 'File read' }] } },
            }),
        }
      }),
      { preconnect: vi.fn() }
    ) as typeof fetch

    const mockContext3 = createMockExecutionContext()

    await executeTool(
      'mcp-123-read_file',
      {
        arguments: JSON.stringify({ file: 'test.txt', mode: 'read' }),
        server: 'mcp-123',
        tool: 'read_file',
      },
      false,
      false,
      mockContext3
    )
  })

  it.concurrent('should handle agent block MCP arguments format', async () => {
    global.fetch = Object.assign(
      vi.fn().mockImplementation(async (url, options) => {
        const body = JSON.parse(options?.body as string)
        expect(body.arguments).toEqual({ query: 'search term', limit: 10 })

        return {
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              success: true,
              data: { output: { content: [{ type: 'text', text: 'Search results' }] } },
            }),
        }
      }),
      { preconnect: vi.fn() }
    ) as typeof fetch

    const mockContext4 = createMockExecutionContext()

    await executeTool(
      'mcp-123-search',
      {
        query: 'search term',
        limit: 10,
        // These should be filtered out as system parameters
        server: 'mcp-123',
        tool: 'search',
        workspaceId: 'workspace-456',
        requestId: 'req-123',
      },
      false,
      false,
      mockContext4
    )
  })

  it.concurrent('should handle MCP tool execution errors', async () => {
    global.fetch = Object.assign(
      vi.fn().mockImplementation(async () => ({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: () =>
          Promise.resolve({
            success: false,
            error: 'Tool not found on server',
          }),
      })),
      { preconnect: vi.fn() }
    ) as typeof fetch

    const mockContext5 = createMockExecutionContext()

    const result = await executeTool(
      'mcp-123-nonexistent_tool',
      { param: 'value' },
      false,
      false,
      mockContext5
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('Tool not found on server')
    expect(result.timing).toBeDefined()
  })

  it.concurrent('should require workspaceId for MCP tools', async () => {
    const result = await executeTool('mcp-123-test_tool', { param: 'value' })

    expect(result.success).toBe(false)
    expect(result.error).toContain('Missing workspaceId in execution context for MCP tool')
  })

  it.concurrent('should handle invalid MCP tool ID format', async () => {
    const mockContext6 = createMockExecutionContext()

    const result = await executeTool(
      'invalid-mcp-id',
      { param: 'value' },
      false,
      false,
      mockContext6
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('Tool not found')
  })

  it.concurrent('should handle MCP API network errors', async () => {
    global.fetch = Object.assign(vi.fn().mockRejectedValue(new Error('Network error')), {
      preconnect: vi.fn(),
    }) as typeof fetch

    const mockContext7 = createMockExecutionContext()

    const result = await executeTool(
      'mcp-123-test_tool',
      { param: 'value' },
      false,
      false,
      mockContext7
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('Network error')
    expect(result.timing).toBeDefined()
  })
})

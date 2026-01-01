/**
 * Tests for workflow export-service API route
 * Tests validation of supported block types and providers
 *
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetSession = vi.fn()
const mockAuthenticateApiKey = vi.fn()
const mockDbSelect = vi.fn()
const mockGetEffectiveDecryptedEnv = vi.fn()
const mockSanitizeForExport = vi.fn()

vi.mock('@/lib/auth', () => ({
  getSession: () => mockGetSession(),
}))

vi.mock('@/lib/api-key/service', () => ({
  authenticateApiKeyFromHeader: () => mockAuthenticateApiKey(),
  updateApiKeyLastUsed: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {
    select: () => mockDbSelect(),
  },
}))

vi.mock('@sim/db/schema', () => ({
  workflow: {},
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
}))

vi.mock('@/lib/environment/utils', () => ({
  getEffectiveDecryptedEnv: () => mockGetEffectiveDecryptedEnv(),
}))

vi.mock('@/lib/workflows/sanitization/json-sanitizer', () => ({
  sanitizeForExport: (data: any) => mockSanitizeForExport(data),
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}))

import { GET } from './route'

describe('Export Service API Route', () => {
  const mockFetch = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()

    // Mock global fetch for internal API calls
    global.fetch = mockFetch

    // Default sanitizer just returns the data
    mockSanitizeForExport.mockImplementation((data) => data)

    // Default env
    mockGetEffectiveDecryptedEnv.mockResolvedValue({})
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('Authentication', () => {
    it('should return 401 when user is not authenticated and no API key', async () => {
      mockGetSession.mockResolvedValue(null)
      mockAuthenticateApiKey.mockResolvedValue({ success: false })

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123/export-service')
      const params = Promise.resolve({ id: 'workflow-123' })

      const response = await GET(req, { params })

      expect(response.status).toBe(401)
      const data = await response.json()
      expect(data.error).toBe('Unauthorized')
    })
  })

  describe('Workflow Validation', () => {
    const setupMocksForWorkflow = (workflowState: any) => {
      mockGetSession.mockResolvedValue({
        user: { id: 'user-123' },
      })

      // Mock db.select to return the workflow row
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{
              id: 'workflow-123',
              userId: 'user-123',
              name: 'Test Workflow',
              workspaceId: null,
            }]),
          }),
        }),
      })

      // Mock fetch for internal API calls
      mockFetch.mockImplementation((url: string) => {
        if (url.includes('/api/workflows/workflow-123/variables')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ data: {} }),
          })
        }
        if (url.includes('/api/workflows/workflow-123')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              data: {
                state: workflowState,
              },
            }),
          })
        }
        return Promise.resolve({ ok: false })
      })
    }

    it('should reject workflow with unsupported block types', async () => {
      setupMocksForWorkflow({
        blocks: {
          'block-1': { id: 'block-1', type: 'start', name: 'Start' },
          'block-2': { id: 'block-2', type: 'evaluator', name: 'Evaluator' },
          'block-3': { id: 'block-3', type: 'code_interpreter', name: 'Code' },
        },
        edges: {},
      })

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123/export-service')
      const params = Promise.resolve({ id: 'workflow-123' })

      const response = await GET(req, { params })

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.error).toBe('Workflow contains unsupported features for export')
      expect(data.unsupportedBlocks).toHaveLength(2)
      expect(data.unsupportedBlocks.map((b: any) => b.type)).toContain('evaluator')
      expect(data.unsupportedBlocks.map((b: any) => b.type)).toContain('code_interpreter')
    })

    it('should accept workflow with unknown model (defaults to OpenAI)', async () => {
      // Unknown models now default to OpenAI-compatible API, so they should be accepted
      setupMocksForWorkflow({
        blocks: {
          'block-1': { id: 'block-1', type: 'start', name: 'Start' },
          'block-2': {
            id: 'block-2',
            type: 'agent',
            name: 'Agent',
            subBlocks: {
              model: { value: 'llama-3-70b' },
            },
          },
          'block-3': { id: 'block-3', type: 'response', name: 'Response' },
        },
        edges: {},
      })

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123/export-service')
      const params = Promise.resolve({ id: 'workflow-123' })

      const response = await GET(req, { params })

      // Should be accepted - unknown models default to OpenAI-compatible API
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('application/zip')
    })

    it('should accept workflow with supported Anthropic model', async () => {
      setupMocksForWorkflow({
        blocks: {
          'block-1': { id: 'block-1', type: 'start', name: 'Start' },
          'block-2': {
            id: 'block-2',
            type: 'agent',
            name: 'Agent',
            subBlocks: {
              model: { value: 'claude-sonnet-4-20250514' },
            },
          },
          'block-3': { id: 'block-3', type: 'response', name: 'Response' },
        },
        edges: {},
      })

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123/export-service')
      const params = Promise.resolve({ id: 'workflow-123' })

      const response = await GET(req, { params })

      // Should return 200 with a ZIP file
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('application/zip')
    })

    it('should accept workflow with supported OpenAI model', async () => {
      setupMocksForWorkflow({
        blocks: {
          'block-1': { id: 'block-1', type: 'start', name: 'Start' },
          'block-2': {
            id: 'block-2',
            type: 'agent',
            name: 'Agent',
            subBlocks: {
              model: { value: 'gpt-4o' },
            },
          },
          'block-3': { id: 'block-3', type: 'response', name: 'Response' },
        },
        edges: {},
      })

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123/export-service')
      const params = Promise.resolve({ id: 'workflow-123' })

      const response = await GET(req, { params })

      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('application/zip')
    })

    it('should accept workflow with supported Google model', async () => {
      setupMocksForWorkflow({
        blocks: {
          'block-1': { id: 'block-1', type: 'start', name: 'Start' },
          'block-2': {
            id: 'block-2',
            type: 'agent',
            name: 'Agent',
            subBlocks: {
              model: { value: 'gemini-1.5-pro' },
            },
          },
          'block-3': { id: 'block-3', type: 'response', name: 'Response' },
        },
        edges: {},
      })

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123/export-service')
      const params = Promise.resolve({ id: 'workflow-123' })

      const response = await GET(req, { params })

      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('application/zip')
    })

    it('should accept workflow with all supported block types', async () => {
      setupMocksForWorkflow({
        blocks: {
          'block-1': { id: 'block-1', type: 'start', name: 'Start' },
          'block-2': { id: 'block-2', type: 'function', name: 'Function' },
          'block-3': { id: 'block-3', type: 'condition', name: 'Condition' },
          'block-4': { id: 'block-4', type: 'router', name: 'Router' },
          'block-5': { id: 'block-5', type: 'api', name: 'API' },
          'block-6': { id: 'block-6', type: 'variables', name: 'Variables' },
          'block-7': { id: 'block-7', type: 'loop', name: 'Loop' },
          'block-8': {
            id: 'block-8',
            type: 'agent',
            name: 'Agent',
            subBlocks: { model: { value: 'claude-sonnet-4-20250514' } },
          },
          'block-9': { id: 'block-9', type: 'response', name: 'Response' },
        },
        edges: {},
      })

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123/export-service')
      const params = Promise.resolve({ id: 'workflow-123' })

      const response = await GET(req, { params })

      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('application/zip')
    })
  })

  describe('Provider Detection', () => {
    const testProviderDetection = async (model: string, shouldPass: boolean) => {
      mockGetSession.mockResolvedValue({
        user: { id: 'user-123' },
      })

      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{
              id: 'workflow-123',
              userId: 'user-123',
              name: 'Test Workflow',
              workspaceId: null,
            }]),
          }),
        }),
      })

      mockFetch.mockImplementation((url: string) => {
        if (url.includes('/api/workflows/workflow-123/variables')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ data: {} }),
          })
        }
        if (url.includes('/api/workflows/workflow-123')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              data: {
                state: {
                  blocks: {
                    'block-1': { id: 'block-1', type: 'start', name: 'Start' },
                    'block-2': {
                      id: 'block-2',
                      type: 'agent',
                      name: 'Agent',
                      subBlocks: { model: { value: model } },
                    },
                    'block-3': { id: 'block-3', type: 'response', name: 'Response' },
                  },
                  edges: {},
                },
              },
            }),
          })
        }
        return Promise.resolve({ ok: false })
      })

      const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123/export-service')
      const params = Promise.resolve({ id: 'workflow-123' })

      const response = await GET(req, { params })
      return response.status === 200
    }

    it('should detect claude models as Anthropic', async () => {
      expect(await testProviderDetection('claude-3-opus-20240229', true)).toBe(true)
    })

    it('should detect GPT models as OpenAI', async () => {
      expect(await testProviderDetection('gpt-4', true)).toBe(true)
    })

    it('should detect o1 models as OpenAI', async () => {
      expect(await testProviderDetection('o1-preview', true)).toBe(true)
    })

    it('should detect Gemini models as Google', async () => {
      expect(await testProviderDetection('gemini-pro', true)).toBe(true)
    })

    it('should detect Grok models as xAI', async () => {
      expect(await testProviderDetection('grok-4-latest', true)).toBe(true)
    })

    it('should detect DeepSeek models', async () => {
      expect(await testProviderDetection('deepseek-chat', true)).toBe(true)
    })

    it('should detect Mistral models', async () => {
      expect(await testProviderDetection('mistral-large-latest', true)).toBe(true)
    })

    it('should detect Groq models', async () => {
      expect(await testProviderDetection('groq/llama-3.3-70b-versatile', true)).toBe(true)
    })

    it('should detect Cerebras models', async () => {
      expect(await testProviderDetection('cerebras/llama-3.3-70b', true)).toBe(true)
    })

    it('should detect OpenRouter models', async () => {
      expect(await testProviderDetection('openrouter/anthropic/claude-3.5-sonnet', true)).toBe(true)
    })

    it('should detect Azure OpenAI models', async () => {
      expect(await testProviderDetection('azure/gpt-4o', true)).toBe(true)
    })

    it('should detect Ollama models', async () => {
      expect(await testProviderDetection('ollama/llama3.1', true)).toBe(true)
    })

    it('should detect vLLM models', async () => {
      expect(await testProviderDetection('vllm/meta-llama/Llama-3-70b', true)).toBe(true)
    })

    it('should accept unknown models (defaults to OpenAI)', async () => {
      // Unknown models now default to OpenAI-compatible API, so they should be accepted
      expect(await testProviderDetection('llama-3-70b', true)).toBe(true)
    })
  })

  describe('Error Handling', () => {
    it('should return 404 when workflow does not exist', async () => {
      mockGetSession.mockResolvedValue({
        user: { id: 'user-123' },
      })

      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      })

      const req = new NextRequest('http://localhost:3000/api/workflows/nonexistent/export-service')
      const params = Promise.resolve({ id: 'nonexistent' })

      const response = await GET(req, { params })

      expect(response.status).toBe(404)
      const data = await response.json()
      expect(data.error).toBe('Workflow not found')
    })
  })
})

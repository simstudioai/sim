/**
 * @vitest-environment jsdom
 *
 * Integration Tests for Validation Architecture
 *
 * These tests verify the complete validation flow:
 * 1. Early validation (serialization) - user-only required fields
 * 2. Late validation (tool execution) - user-or-llm required fields
 */
import { describe, expect, it, vi } from 'vitest'
import { Serializer } from '@/serializer/index'
import { validateRequiredParametersAfterMerge } from '@/tools/utils'

vi.mock('@/blocks', () => ({
  getBlock: (type: string) => {
    const mockConfigs: Record<string, any> = {
      jina: {
        name: 'Jina',
        description: 'Convert website content into text',
        category: 'tools',
        bgColor: '#333333',
        tools: {
          access: ['jina_read_url'],
        },
        subBlocks: [
          { id: 'url', type: 'short-input', title: 'URL', required: true },
          { id: 'apiKey', type: 'short-input', title: 'API Key', required: true },
        ],
        inputs: {
          url: { type: 'string' },
          apiKey: { type: 'string' },
        },
      },
      reddit: {
        name: 'Reddit',
        description: 'Access Reddit data',
        category: 'tools',
        bgColor: '#FF5700',
        tools: {
          access: ['reddit_get_posts'],
        },
        subBlocks: [
          { id: 'operation', type: 'dropdown', title: 'Operation', required: true },
          { id: 'credential', type: 'oauth-input', title: 'Reddit Account', required: true },
          { id: 'subreddit', type: 'short-input', title: 'Subreddit', required: true },
        ],
        inputs: {
          operation: { type: 'string' },
          credential: { type: 'string' },
          subreddit: { type: 'string' },
        },
      },
    }
    return mockConfigs[type] || null
  },
}))

vi.mock('@/tools/utils', async () => {
  const actual = await vi.importActual('@/tools/utils')
  return {
    ...actual,
    getTool: (toolId: string) => {
      const mockTools: Record<string, any> = {
        jina_read_url: {
          name: 'Jina Reader',
          params: {
            url: {
              type: 'string',
              visibility: 'user-or-llm',
              required: true,
              description: 'URL to extract content from',
            },
            apiKey: {
              type: 'string',
              visibility: 'user-only',
              required: true,
              description: 'Your Jina API key',
            },
          },
        },
        reddit_get_posts: {
          name: 'Reddit Posts',
          params: {
            subreddit: {
              type: 'string',
              visibility: 'user-or-llm',
              required: true,
              description: 'Subreddit name',
            },
            credential: {
              type: 'string',
              visibility: 'user-only',
              required: true,
              description: 'Reddit credentials',
            },
          },
        },
      }
      return mockTools[toolId] || null
    },
  }
})

describe('Validation Integration Tests', () => {
  it.concurrent('early validation should catch missing user-only fields', () => {
    const serializer = new Serializer()

    // Block missing user-only field (API key)
    const blockWithMissingUserOnlyField: any = {
      id: 'jina-block',
      type: 'jina',
      name: 'Jina Content Extractor',
      position: { x: 0, y: 0 },
      subBlocks: {
        url: { value: 'https://example.com' }, // Present
        apiKey: { value: null }, // Missing user-only field
      },
      outputs: {},
      enabled: true,
    }

    // Should fail at serialization (early validation)
    expect(() => {
      serializer.serializeWorkflow(
        { 'jina-block': blockWithMissingUserOnlyField },
        [],
        {},
        undefined,
        true
      )
    }).toThrow('Jina Content Extractor is missing required fields: API Key')
  })

  it.concurrent(
    'early validation should allow missing user-or-llm fields (LLM can provide later)',
    () => {
      const serializer = new Serializer()

      // Block missing user-or-llm field (URL) but has user-only field (API key)
      const blockWithMissingUserOrLlmField: any = {
        id: 'jina-block',
        type: 'jina',
        name: 'Jina Content Extractor',
        position: { x: 0, y: 0 },
        subBlocks: {
          url: { value: null }, // Missing user-or-llm field (LLM can provide)
          apiKey: { value: 'test-api-key' }, // Present user-only field
        },
        outputs: {},
        enabled: true,
      }

      // Should pass serialization (early validation doesn't check user-or-llm fields)
      expect(() => {
        serializer.serializeWorkflow(
          { 'jina-block': blockWithMissingUserOrLlmField },
          [],
          {},
          undefined,
          true
        )
      }).not.toThrow()
    }
  )

  it.concurrent(
    'late validation should catch missing user-or-llm fields after parameter merge',
    () => {
      // Simulate parameters after user + LLM merge
      const mergedParams = {
        url: null, // Missing user-or-llm field
        apiKey: 'test-api-key', // Present user-only field
      }

      // Should fail at tool validation (late validation)
      expect(() => {
        validateRequiredParametersAfterMerge(
          'jina_read_url',
          {
            name: 'Jina Reader',
            params: {
              url: {
                type: 'string',
                visibility: 'user-or-llm',
                required: true,
                description: 'URL to extract content from',
              },
              apiKey: {
                type: 'string',
                visibility: 'user-only',
                required: true,
                description: 'Your Jina API key',
              },
            },
          } as any,
          mergedParams
        )
      }).toThrow('"Url" is required for Jina Reader')
    }
  )

  it.concurrent('late validation should NOT validate user-only fields (validated earlier)', () => {
    // Simulate parameters after user + LLM merge - missing user-only field
    const mergedParams = {
      url: 'https://example.com', // Present user-or-llm field
      apiKey: null, // Missing user-only field (but shouldn't be checked here)
    }

    // Should pass tool validation (late validation doesn't check user-only fields)
    expect(() => {
      validateRequiredParametersAfterMerge(
        'jina_read_url',
        {
          name: 'Jina Reader',
          params: {
            url: {
              type: 'string',
              visibility: 'user-or-llm',
              required: true,
              description: 'URL to extract content from',
            },
            apiKey: {
              type: 'string',
              visibility: 'user-only',
              required: true,
              description: 'Your Jina API key',
            },
          },
        } as any,
        mergedParams
      )
    }).not.toThrow()
  })

  it.concurrent('complete validation flow: both layers working together', () => {
    const serializer = new Serializer()

    // Scenario 1: Missing user-only field - should fail at serialization
    const blockMissingUserOnly: any = {
      id: 'reddit-block',
      type: 'reddit',
      name: 'Reddit Posts',
      position: { x: 0, y: 0 },
      subBlocks: {
        operation: { value: 'get_posts' },
        credential: { value: null }, // Missing user-only
        subreddit: { value: 'programming' }, // Present user-or-llm
      },
      outputs: {},
      enabled: true,
    }

    expect(() => {
      serializer.serializeWorkflow(
        { 'reddit-block': blockMissingUserOnly },
        [],
        {},
        undefined,
        true
      )
    }).toThrow('Reddit Posts is missing required fields: Reddit Account')

    // Scenario 2: Has user-only fields but missing user-or-llm - should pass serialization
    const blockMissingUserOrLlm: any = {
      id: 'reddit-block',
      type: 'reddit',
      name: 'Reddit Posts',
      position: { x: 0, y: 0 },
      subBlocks: {
        operation: { value: 'get_posts' },
        credential: { value: 'reddit-token' }, // Present user-only
        subreddit: { value: null }, // Missing user-or-llm
      },
      outputs: {},
      enabled: true,
    }

    // Should pass serialization
    expect(() => {
      serializer.serializeWorkflow(
        { 'reddit-block': blockMissingUserOrLlm },
        [],
        {},
        undefined,
        true
      )
    }).not.toThrow()

    // But should fail at tool validation
    const mergedParams = {
      subreddit: null, // Missing user-or-llm field
      credential: 'reddit-token', // Present user-only field
    }

    expect(() => {
      validateRequiredParametersAfterMerge(
        'reddit_get_posts',
        {
          name: 'Reddit Posts',
          params: {
            subreddit: {
              type: 'string',
              visibility: 'user-or-llm',
              required: true,
              description: 'Subreddit name',
            },
            credential: {
              type: 'string',
              visibility: 'user-only',
              required: true,
              description: 'Reddit credentials',
            },
          },
        } as any,
        mergedParams
      )
    }).toThrow('"Subreddit" is required for Reddit Posts')
  })

  it.concurrent('complete success: all required fields provided correctly', () => {
    const serializer = new Serializer()

    // Block with all required fields present
    const completeBlock: any = {
      id: 'jina-block',
      type: 'jina',
      name: 'Jina Content Extractor',
      position: { x: 0, y: 0 },
      subBlocks: {
        url: { value: 'https://example.com' }, // Present user-or-llm
        apiKey: { value: 'test-api-key' }, // Present user-only
      },
      outputs: {},
      enabled: true,
    }

    // Should pass serialization (early validation)
    expect(() => {
      serializer.serializeWorkflow({ 'jina-block': completeBlock }, [], {}, undefined, true)
    }).not.toThrow()

    // Should pass tool validation (late validation)
    const completeParams = {
      url: 'https://example.com',
      apiKey: 'test-api-key',
    }

    expect(() => {
      validateRequiredParametersAfterMerge(
        'jina_read_url',
        {
          name: 'Jina Reader',
          params: {
            url: {
              type: 'string',
              visibility: 'user-or-llm',
              required: true,
              description: 'URL to extract content from',
            },
            apiKey: {
              type: 'string',
              visibility: 'user-only',
              required: true,
              description: 'Your Jina API key',
            },
          },
        } as any,
        completeParams
      )
    }).not.toThrow()
  })
})

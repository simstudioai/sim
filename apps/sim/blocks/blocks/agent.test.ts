import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentBlock } from '@/blocks/blocks/agent'

vi.mock('@/blocks', () => ({
  getAllBlocks: vi.fn(() => [
    {
      type: 'tool-type-1',
      tools: {
        access: ['tool-id-1'],
      },
    },
    {
      type: 'tool-type-2',
      tools: {
        access: ['tool-id-2'],
      },
    },
  ]),
}))

describe('AgentBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const paramsFunction = AgentBlock.tools.config?.params

  if (!paramsFunction) {
    throw new Error('AgentBlock.tools.config.params function is missing')
  }

  describe('tools.config.params function', () => {
    it('should pass through params when no tools array is provided', () => {
      const params = {
        model: 'gpt-4o',
        systemPrompt: 'You are a helpful assistant.',
        // No tools provided
      }

      const result = paramsFunction(params)
      expect(result).toEqual(params)
    })

    it('should filter out tools with usageControl set to "none"', () => {
      const params = {
        model: 'gpt-4o',
        systemPrompt: 'You are a helpful assistant.',
        tools: [
          {
            type: 'tool-type-1',
            title: 'Tool 1',
            usageControl: 'auto',
          },
          {
            type: 'tool-type-2',
            title: 'Tool 2',
            usageControl: 'none', // Should be filtered out
          },
          {
            type: 'custom-tool',
            title: 'Custom Tool',
            schema: {
              function: {
                name: 'custom_function',
                description: 'A custom function',
                parameters: { type: 'object', properties: {} },
              },
            },
            usageControl: 'force',
          },
        ],
      }

      const result = paramsFunction(params)

      // Verify that transformed tools contains only the tools not set to 'none'
      expect(result.tools.length).toBe(2)

      // Verify the tool titles (custom identifiers that we can check)
      const toolIds = result.tools.map((tool: any) => tool.name)
      expect(toolIds).toContain('Tool 1')
      expect(toolIds).not.toContain('Tool 2')
      expect(toolIds).toContain('Custom Tool')
    })

    it('should set default usageControl to "auto" if not specified', () => {
      const params = {
        model: 'gpt-4o',
        systemPrompt: 'You are a helpful assistant.',
        tools: [
          {
            type: 'tool-type-1',
            title: 'Tool 1',
            // No usageControl specified, should default to 'auto'
          },
        ],
      }

      const result = paramsFunction(params)

      // Verify that the tool has usageControl set to 'auto'
      expect(result.tools[0].usageControl).toBe('auto')
    })

    it('should correctly transform custom tools', () => {
      const params = {
        model: 'gpt-4o',
        systemPrompt: 'You are a helpful assistant.',
        tools: [
          {
            type: 'custom-tool',
            title: 'Custom Tool',
            schema: {
              function: {
                name: 'custom_function',
                description: 'A custom function description',
                parameters: {
                  type: 'object',
                  properties: {
                    param1: { type: 'string' },
                  },
                },
              },
            },
            usageControl: 'force',
          },
        ],
      }

      const result = paramsFunction(params)

      // Verify custom tool transformation
      expect(result.tools[0]).toEqual({
        id: 'custom_function',
        name: 'Custom Tool',
        description: 'A custom function description',
        params: {},
        parameters: {
          type: 'object',
          properties: {
            param1: { type: 'string' },
          },
        },
        type: 'custom-tool',
        usageControl: 'force',
      })
    })

    it('should handle an empty tools array', () => {
      const params = {
        model: 'gpt-4o',
        systemPrompt: 'You are a helpful assistant.',
        tools: [], // Empty array
      }

      const result = paramsFunction(params)

      // Verify that transformed tools is an empty array
      expect(result.tools).toEqual([])
    })
  })
})

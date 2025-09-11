import { describe, expect, it, vi } from 'vitest'
import { checkTagTrigger } from '@/components/ui/tag-dropdown'
import { extractFieldsFromSchema, parseResponseFormatSafely } from '@/lib/response-format'
import type { BlockState } from '@/stores/workflows/workflow/types'
import { generateLoopBlocks } from '@/stores/workflows/workflow/utils'

// Mock getTool function for testing tool output types
vi.mock('@/lib/get-tool', () => ({
  getTool: vi.fn((toolId: string) => {
    // Mock different tool configurations for testing
    const mockTools: Record<string, any> = {
      exa_search: {
        outputs: {
          results: {
            type: 'array',
            description: 'Search results with titles, URLs, and text snippets',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string', description: 'The title of the search result' },
                url: { type: 'string', description: 'The URL of the search result' },
                score: { type: 'number', description: 'Relevance score for the search result' },
              },
            },
          },
        },
      },
      pinecone_search_text: {
        outputs: {
          matches: {
            type: 'array',
            description: 'Search results with ID, score, and metadata',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Vector ID' },
                score: { type: 'number', description: 'Similarity score' },
                metadata: { type: 'object', description: 'Associated metadata' },
              },
            },
          },
          usage: {
            type: 'object',
            description: 'Usage statistics including tokens, read units, and rerank units',
            properties: {
              total_tokens: { type: 'number', description: 'Total tokens used for embedding' },
              read_units: { type: 'number', description: 'Read units consumed' },
              rerank_units: { type: 'number', description: 'Rerank units used' },
            },
          },
        },
      },
      notion_query_database: {
        outputs: {
          content: {
            type: 'string',
            description: 'Formatted list of database entries with their properties',
          },
          metadata: {
            type: 'object',
            description:
              'Query metadata including total results count, pagination info, and raw results array',
            properties: {
              totalResults: { type: 'number', description: 'Number of results returned' },
              hasMore: { type: 'boolean', description: 'Whether more results are available' },
              results: {
                type: 'array',
                description: 'Raw Notion page objects',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', description: 'Page ID' },
                    properties: { type: 'object', description: 'Page properties' },
                  },
                },
              },
            },
          },
        },
      },
    }
    return mockTools[toolId] || null
  }),
}))

// Mock getBlock function for testing
vi.mock('@/lib/get-block', () => ({
  getBlock: vi.fn((blockType: string) => {
    const mockBlockConfigs: Record<string, any> = {
      exa: {
        tools: {
          config: {
            tool: ({ operation }: { operation: string }) => `exa_${operation}`,
          },
        },
      },
      tools: {
        tools: {
          config: {
            tool: ({ operation }: { operation: string }) => `pinecone_${operation}`,
          },
        },
      },
      notion: {
        tools: {
          config: {
            tool: ({ operation }: { operation: string }) => `notion_${operation}`,
          },
        },
      },
    }
    return mockBlockConfigs[blockType] || null
  }),
}))

vi.mock('@/stores/workflows/workflow/store', () => ({
  useWorkflowStore: vi.fn(() => ({
    blocks: {},
    edges: [],
  })),
}))

vi.mock('@/stores/workflows/registry/store', () => ({
  useWorkflowRegistry: vi.fn(() => ({
    activeWorkflowId: 'test-workflow',
  })),
}))

vi.mock('@/stores/panel/variables/store', () => ({
  useVariablesStore: vi.fn(() => ({
    getVariablesByWorkflowId: vi.fn(() => []),
    loadVariables: vi.fn(),
    variables: {},
  })),
}))

vi.mock('@/stores/workflows/subblock/store', () => ({
  useSubBlockStore: vi.fn(() => ({
    getValue: vi.fn(() => null),
    getState: vi.fn(() => ({
      getValue: vi.fn(() => null),
    })),
  })),
}))

// Mock trigger functions
vi.mock('@/triggers/utils', () => ({
  getTriggersByProvider: vi.fn((provider: string) => {
    const mockTriggers: Record<string, any[]> = {
      outlook: [
        {
          id: 'outlook_poller',
          name: 'Outlook Email Trigger',
          outputs: {
            email: {
              id: { type: 'string', description: 'Outlook message ID' },
              conversationId: { type: 'string', description: 'Outlook conversation ID' },
              subject: { type: 'string', description: 'Email subject line' },
              hasAttachments: { type: 'boolean', description: 'Whether email has attachments' },
              isRead: { type: 'boolean', description: 'Whether email is read' },
              from: { type: 'string', description: 'Email sender' },
              to: { type: 'string', description: 'Email recipient' },
              cc: { type: 'string', description: 'CC recipients' },
              date: { type: 'string', description: 'Email date' },
              bodyText: { type: 'string', description: 'Email body text' },
              bodyHtml: { type: 'string', description: 'Email body HTML' },
              folderId: { type: 'string', description: 'Folder ID' },
              messageId: { type: 'string', description: 'Message ID' },
              threadId: { type: 'string', description: 'Thread ID' },
            },
            timestamp: { type: 'string', description: 'Event timestamp' },
            rawEmail: {
              type: 'json',
              description: 'Complete raw email data from Microsoft Graph API',
            },
          },
        },
      ],
      slack: [
        {
          id: 'slack_message',
          name: 'Slack Message Trigger',
          outputs: {
            message: {
              text: { type: 'string', description: 'Message text' },
              user: { type: 'string', description: 'User ID' },
              channel: { type: 'string', description: 'Channel ID' },
              timestamp: { type: 'string', description: 'Message timestamp' },
            },
            channel: { type: 'string', description: 'Channel information' },
          },
        },
      ],
    }
    return mockTriggers[provider] || []
  }),
}))

describe('TagDropdown Trigger Output Parsing', () => {
  it.concurrent('should parse trigger outputs correctly for outlook trigger', () => {
    // Mock getTriggersByProvider function directly
    const getTriggersByProvider = vi.fn((provider: string) => {
      const mockTriggers: Record<string, any[]> = {
        outlook: [
          {
            id: 'outlook_poller',
            name: 'Outlook Email Trigger',
            outputs: {
              email: {
                id: { type: 'string', description: 'Outlook message ID' },
                conversationId: { type: 'string', description: 'Outlook conversation ID' },
                subject: { type: 'string', description: 'Email subject line' },
                hasAttachments: { type: 'boolean', description: 'Whether email has attachments' },
                isRead: { type: 'boolean', description: 'Whether email is read' },
              },
              timestamp: { type: 'string', description: 'Event timestamp' },
              rawEmail: { type: 'json', description: 'Complete raw email data' },
            },
          },
        ],
      }
      return mockTriggers[provider] || []
    })

    const triggers = getTriggersByProvider('outlook')
    const firstTrigger = triggers[0]

    expect(firstTrigger).toBeDefined()
    expect(firstTrigger.outputs).toBeDefined()
    expect(firstTrigger.outputs.email).toBeDefined()
    expect(firstTrigger.outputs.timestamp).toBeDefined()
    expect(firstTrigger.outputs.rawEmail).toBeDefined()

    // Verify email nested properties
    expect(firstTrigger.outputs.email.id.type).toBe('string')
    expect(firstTrigger.outputs.email.subject.type).toBe('string')
    expect(firstTrigger.outputs.email.hasAttachments.type).toBe('boolean')
    expect(firstTrigger.outputs.email.isRead.type).toBe('boolean')
  })

  it.concurrent(
    'should get correct output type for trigger paths using getOutputTypeForPath',
    () => {
      // Mock getTriggersByProvider function directly
      const getTriggersByProvider = vi.fn((provider: string) => {
        const mockTriggers: Record<string, any[]> = {
          outlook: [
            {
              id: 'outlook_poller',
              outputs: {
                email: {
                  id: { type: 'string' },
                  subject: { type: 'string' },
                  hasAttachments: { type: 'boolean' },
                  isRead: { type: 'boolean' },
                  from: { type: 'string' },
                  to: { type: 'string' },
                },
                timestamp: { type: 'string' },
                rawEmail: { type: 'json' },
              },
            },
          ],
        }
        return mockTriggers[provider] || []
      })

      // Mock the getOutputTypeForPath function behavior for triggers
      const getOutputTypeForPath = (
        block: any,
        blockConfig: any,
        blockId: string,
        outputPath: string
      ): string => {
        if (block?.triggerMode && blockConfig?.triggers?.enabled) {
          const triggers = getTriggersByProvider(block.type)
          const firstTrigger = triggers[0]

          if (firstTrigger?.outputs) {
            const pathParts = outputPath.split('.')
            let currentObj: any = firstTrigger.outputs

            for (const part of pathParts) {
              if (currentObj && typeof currentObj === 'object') {
                currentObj = currentObj[part]
              } else {
                break
              }
            }

            if (
              currentObj &&
              typeof currentObj === 'object' &&
              'type' in currentObj &&
              currentObj.type
            ) {
              return currentObj.type
            }
          }
        }

        return 'any'
      }

      const block = {
        id: 'outlook1',
        type: 'outlook',
        triggerMode: true,
      }

      const blockConfig = {
        triggers: { enabled: true },
      }

      // Test top-level trigger outputs
      expect(getOutputTypeForPath(block, blockConfig, 'outlook1', 'timestamp')).toBe('string')
      expect(getOutputTypeForPath(block, blockConfig, 'outlook1', 'rawEmail')).toBe('json')

      // Test nested email properties
      expect(getOutputTypeForPath(block, blockConfig, 'outlook1', 'email.id')).toBe('string')
      expect(getOutputTypeForPath(block, blockConfig, 'outlook1', 'email.subject')).toBe('string')
      expect(getOutputTypeForPath(block, blockConfig, 'outlook1', 'email.hasAttachments')).toBe(
        'boolean'
      )
      expect(getOutputTypeForPath(block, blockConfig, 'outlook1', 'email.isRead')).toBe('boolean')
      expect(getOutputTypeForPath(block, blockConfig, 'outlook1', 'email.from')).toBe('string')
      expect(getOutputTypeForPath(block, blockConfig, 'outlook1', 'email.to')).toBe('string')

      // Test non-existent paths
      expect(getOutputTypeForPath(block, blockConfig, 'outlook1', 'email.nonexistent')).toBe('any')
      expect(getOutputTypeForPath(block, blockConfig, 'outlook1', 'nonexistent')).toBe('any')
    }
  )

  it.concurrent('should handle trigger output navigation for parent objects', () => {
    const getTriggersByProvider = vi.fn((provider: string) => {
      const mockTriggers: Record<string, any[]> = {
        outlook: [
          {
            outputs: {
              email: {
                id: { type: 'string' },
                subject: { type: 'string' },
              },
              timestamp: { type: 'string' },
            },
          },
        ],
      }
      return mockTriggers[provider] || []
    })

    const getOutputTypeForPath = (
      block: any,
      blockConfig: any,
      blockId: string,
      outputPath: string
    ): string => {
      if (block?.triggerMode && blockConfig?.triggers?.enabled) {
        const triggers = getTriggersByProvider(block.type)
        const firstTrigger = triggers[0]

        if (firstTrigger?.outputs) {
          const pathParts = outputPath.split('.')
          let currentObj: any = firstTrigger.outputs

          for (const part of pathParts) {
            if (currentObj && typeof currentObj === 'object') {
              currentObj = currentObj[part]
            } else {
              break
            }
          }

          if (
            currentObj &&
            typeof currentObj === 'object' &&
            'type' in currentObj &&
            currentObj.type
          ) {
            return currentObj.type
          }

          // Check if currentObj is a parent object with nested properties
          if (currentObj && typeof currentObj === 'object' && !('type' in currentObj)) {
            return 'object'
          }
        }
      }

      return 'any'
    }

    const block = {
      id: 'outlook1',
      type: 'outlook',
      triggerMode: true,
    }

    const blockConfig = {
      triggers: { enabled: true },
    }

    // Test parent object (email should be treated as object type)
    expect(getOutputTypeForPath(block, blockConfig, 'outlook1', 'email')).toBe('object')
  })

  it.concurrent('should return "any" for non-trigger blocks', () => {
    const getOutputTypeForPath = (
      block: any,
      blockConfig: any,
      blockId: string,
      outputPath: string
    ): string => {
      if (block?.triggerMode && blockConfig?.triggers?.enabled) {
        const { getTriggersByProvider } = require('@/triggers/utils')
        const triggers = getTriggersByProvider(block.type)
        const firstTrigger = triggers[0]

        if (firstTrigger?.outputs) {
          const pathParts = outputPath.split('.')
          let currentObj: any = firstTrigger.outputs

          for (const part of pathParts) {
            if (currentObj && typeof currentObj === 'object') {
              currentObj = currentObj[part]
            } else {
              break
            }
          }

          if (
            currentObj &&
            typeof currentObj === 'object' &&
            'type' in currentObj &&
            currentObj.type
          ) {
            return currentObj.type
          }
        }
      }

      return 'any'
    }

    // Test block without trigger mode
    const normalBlock = {
      id: 'outlook1',
      type: 'outlook',
      triggerMode: false,
    }

    const blockConfig = {
      triggers: { enabled: true },
    }

    expect(getOutputTypeForPath(normalBlock, blockConfig, 'outlook1', 'email.id')).toBe('any')

    // Test block with trigger mode but triggers not enabled
    const triggerBlockNoConfig = {
      id: 'outlook1',
      type: 'outlook',
      triggerMode: true,
    }

    const noTriggersConfig = {
      triggers: { enabled: false },
    }

    expect(
      getOutputTypeForPath(triggerBlockNoConfig, noTriggersConfig, 'outlook1', 'email.id')
    ).toBe('any')
  })

  it.concurrent('should handle different trigger providers correctly', () => {
    const getTriggersByProvider = vi.fn((provider: string) => {
      const mockTriggers: Record<string, any[]> = {
        slack: [
          {
            outputs: {
              message: {
                text: { type: 'string' },
                user: { type: 'string' },
                channel: { type: 'string' },
              },
              channel: { type: 'string' },
            },
          },
        ],
      }
      return mockTriggers[provider] || []
    })

    const getOutputTypeForPath = (
      block: any,
      blockConfig: any,
      blockId: string,
      outputPath: string
    ): string => {
      if (block?.triggerMode && blockConfig?.triggers?.enabled) {
        const triggers = getTriggersByProvider(block.type)
        const firstTrigger = triggers[0]

        if (firstTrigger?.outputs) {
          const pathParts = outputPath.split('.')
          let currentObj: any = firstTrigger.outputs

          for (const part of pathParts) {
            if (currentObj && typeof currentObj === 'object') {
              currentObj = currentObj[part]
            } else {
              break
            }
          }

          if (
            currentObj &&
            typeof currentObj === 'object' &&
            'type' in currentObj &&
            currentObj.type
          ) {
            return currentObj.type
          }
        }
      }

      return 'any'
    }

    // Test Slack trigger
    const slackBlock = {
      id: 'slack1',
      type: 'slack',
      triggerMode: true,
    }

    const blockConfig = {
      triggers: { enabled: true },
    }

    expect(getOutputTypeForPath(slackBlock, blockConfig, 'slack1', 'message.text')).toBe('string')
    expect(getOutputTypeForPath(slackBlock, blockConfig, 'slack1', 'message.user')).toBe('string')
    expect(getOutputTypeForPath(slackBlock, blockConfig, 'slack1', 'channel')).toBe('string')
  })

  it.concurrent('should handle malformed or missing trigger configurations gracefully', () => {
    const getOutputTypeForPath = (
      block: any,
      blockConfig: any,
      blockId: string,
      outputPath: string
    ): string => {
      if (block?.triggerMode && blockConfig?.triggers?.enabled) {
        try {
          const { getTriggersByProvider } = require('@/triggers/utils')
          const triggers = getTriggersByProvider(block.type)
          const firstTrigger = triggers[0]

          if (firstTrigger?.outputs) {
            const pathParts = outputPath.split('.')
            let currentObj: any = firstTrigger.outputs

            for (const part of pathParts) {
              if (currentObj && typeof currentObj === 'object') {
                currentObj = currentObj[part]
              } else {
                break
              }
            }

            if (
              currentObj &&
              typeof currentObj === 'object' &&
              'type' in currentObj &&
              currentObj.type
            ) {
              return currentObj.type
            }
          }
        } catch (error) {
          return 'any'
        }
      }

      return 'any'
    }

    // Test with unknown trigger provider
    const unknownBlock = {
      id: 'unknown1',
      type: 'unknown_provider',
      triggerMode: true,
    }

    const blockConfig = {
      triggers: { enabled: true },
    }

    expect(getOutputTypeForPath(unknownBlock, blockConfig, 'unknown1', 'any.path')).toBe('any')

    // Test with null/undefined configurations
    expect(getOutputTypeForPath(null, blockConfig, 'test', 'path')).toBe('any')
    expect(getOutputTypeForPath(unknownBlock, null, 'test', 'path')).toBe('any')
  })

  it.concurrent('should generate correct trigger output tags for dropdown', () => {
    const getTriggersByProvider = vi.fn((provider: string) => {
      const mockTriggers: Record<string, any[]> = {
        outlook: [
          {
            outputs: {
              email: {
                id: { type: 'string' },
                subject: { type: 'string' },
                hasAttachments: { type: 'boolean' },
                isRead: { type: 'boolean' },
              },
              timestamp: { type: 'string' },
              rawEmail: { type: 'json' },
            },
          },
        ],
        slack: [
          {
            outputs: {
              message: {
                text: { type: 'string' },
                user: { type: 'string' },
              },
              channel: { type: 'string' },
            },
          },
        ],
      }
      return mockTriggers[provider] || []
    })

    // Mock trigger output tag generation
    const generateTriggerOutputTags = (blockType: string, blockId: string): string[] => {
      const triggers = getTriggersByProvider(blockType)
      const firstTrigger = triggers[0]

      if (!firstTrigger?.outputs) return []

      const tags: string[] = []
      const normalizedBlockId = blockId.replace(/\s+/g, '').toLowerCase()

      const traverseOutputs = (outputs: any, prefix = '') => {
        for (const [key, output] of Object.entries(outputs)) {
          const currentPath = prefix ? `${prefix}.${key}` : key
          const fullTag = `${normalizedBlockId}.${currentPath}`

          tags.push(fullTag)

          // If this is a parent object with nested properties, recurse
          if (output && typeof output === 'object' && !('type' in output)) {
            traverseOutputs(output, currentPath)
          }
        }
      }

      traverseOutputs(firstTrigger.outputs)
      return tags
    }

    // Test Outlook trigger tags
    const outlookTags = generateTriggerOutputTags('outlook', 'Outlook 1')

    expect(outlookTags).toContain('outlook1.email')
    expect(outlookTags).toContain('outlook1.email.id')
    expect(outlookTags).toContain('outlook1.email.subject')
    expect(outlookTags).toContain('outlook1.email.hasAttachments')
    expect(outlookTags).toContain('outlook1.email.isRead')
    expect(outlookTags).toContain('outlook1.timestamp')
    expect(outlookTags).toContain('outlook1.rawEmail')

    // Test Slack trigger tags
    const slackTags = generateTriggerOutputTags('slack', 'Slack 1')

    expect(slackTags).toContain('slack1.message')
    expect(slackTags).toContain('slack1.message.text')
    expect(slackTags).toContain('slack1.message.user')
    expect(slackTags).toContain('slack1.channel')
  })

  it.concurrent('should correctly identify trigger vs tool output resolution', () => {
    const getTriggersByProvider = vi.fn((provider: string) => {
      const mockTriggers: Record<string, any[]> = {
        outlook: [
          {
            outputs: {
              email: {
                id: { type: 'string' },
              },
            },
          },
        ],
      }
      return mockTriggers[provider] || []
    })

    const getOutputTypeForPath = (
      block: any,
      blockConfig: any,
      blockId: string,
      outputPath: string
    ): string => {
      if (block?.triggerMode && blockConfig?.triggers?.enabled) {
        // Trigger mode logic
        const triggers = getTriggersByProvider(block.type)
        const firstTrigger = triggers[0]

        if (firstTrigger?.outputs) {
          const pathParts = outputPath.split('.')
          let currentObj: any = firstTrigger.outputs

          for (const part of pathParts) {
            if (currentObj && typeof currentObj === 'object') {
              currentObj = currentObj[part]
            } else {
              break
            }
          }

          if (
            currentObj &&
            typeof currentObj === 'object' &&
            'type' in currentObj &&
            currentObj.type
          ) {
            return currentObj.type
          }
        }
      } else {
        // Tool mode logic - simplified mock
        if (blockConfig && outputPath === 'results') {
          return 'array'
        }
      }

      return 'any'
    }

    // Test trigger mode
    const triggerBlock = {
      id: 'outlook1',
      type: 'outlook',
      triggerMode: true,
    }

    const triggerConfig = {
      triggers: { enabled: true },
    }

    expect(getOutputTypeForPath(triggerBlock, triggerConfig, 'outlook1', 'email.id')).toBe('string')

    // Test tool mode
    const toolBlock = {
      id: 'outlook1',
      type: 'outlook',
      triggerMode: false,
    }

    const toolConfig = {
      triggers: { enabled: false },
    }

    expect(getOutputTypeForPath(toolBlock, toolConfig, 'outlook1', 'results')).toBe('array')
    expect(getOutputTypeForPath(toolBlock, toolConfig, 'outlook1', 'email.id')).toBe('any')
  })
})

describe('TagDropdown Loop Suggestions', () => {
  it.concurrent('should generate correct loop suggestions for forEach loops', () => {
    const blocks: Record<string, BlockState> = {
      loop1: {
        id: 'loop1',
        type: 'loop',
        name: 'Test Loop',
        position: { x: 0, y: 0 },
        subBlocks: {},
        outputs: {},
        enabled: true,
        data: {
          loopType: 'forEach',
          collection: '["item1", "item2", "item3"]',
        },
      },
      function1: {
        id: 'function1',
        type: 'function',
        name: 'Function 1',
        position: { x: 0, y: 0 },
        subBlocks: {},
        outputs: {},
        enabled: true,
        data: {
          parentId: 'loop1',
        },
      },
    }

    const loops = generateLoopBlocks(blocks)

    // Verify loop was generated correctly
    expect(loops.loop1).toBeDefined()
    expect(loops.loop1.loopType).toBe('forEach')
    expect(loops.loop1.forEachItems).toEqual(['item1', 'item2', 'item3'])
    expect(loops.loop1.nodes).toContain('function1')

    // Simulate the tag generation logic from TagDropdown
    const loopTags: string[] = []
    const containingLoop = Object.entries(loops).find(([_, loop]) =>
      loop.nodes.includes('function1')
    )

    if (containingLoop) {
      const [_loopId, loop] = containingLoop
      const loopType = loop.loopType || 'for'

      // Add loop.index for all loop types
      loopTags.push('loop.index')

      // Add forEach specific properties
      if (loopType === 'forEach') {
        loopTags.push('loop.currentItem')
        loopTags.push('loop.items')
      }
    }

    // Verify all loop tags are present
    expect(loopTags).toContain('loop.index')
    expect(loopTags).toContain('loop.currentItem')
    expect(loopTags).toContain('loop.items')
    expect(loopTags).toHaveLength(3)
  })

  it.concurrent('should only generate loop.index for regular for loops', () => {
    const blocks: Record<string, BlockState> = {
      loop1: {
        id: 'loop1',
        type: 'loop',
        name: 'Test Loop',
        position: { x: 0, y: 0 },
        subBlocks: {},
        outputs: {},
        enabled: true,
        data: {
          loopType: 'for',
          count: 5,
          collection: '',
        },
      },
      function1: {
        id: 'function1',
        type: 'function',
        name: 'Function 1',
        position: { x: 0, y: 0 },
        subBlocks: {},
        outputs: {},
        enabled: true,
        data: {
          parentId: 'loop1',
        },
      },
    }

    const loops = generateLoopBlocks(blocks)

    // Simulate the tag generation logic
    const loopTags: string[] = []
    const containingLoop = Object.entries(loops).find(([_, loop]) =>
      loop.nodes.includes('function1')
    )

    if (containingLoop) {
      const [_loopId, loop] = containingLoop
      const loopType = loop.loopType || 'for'

      loopTags.push('loop.index')

      if (loopType === 'forEach') {
        loopTags.push('loop.currentItem')
        loopTags.push('loop.items')
      }
    }

    // For regular loops, should only have loop.index
    expect(loopTags).toContain('loop.index')
    expect(loopTags).not.toContain('loop.currentItem')
    expect(loopTags).not.toContain('loop.items')
    expect(loopTags).toHaveLength(1)
  })
})

describe('TagDropdown Parallel Suggestions', () => {
  it.concurrent('should generate correct parallel suggestions', () => {
    const blocks: Record<string, BlockState> = {
      parallel1: {
        id: 'parallel1',
        type: 'parallel',
        name: 'Test Parallel',
        position: { x: 0, y: 0 },
        subBlocks: {},
        outputs: {},
        enabled: true,
        data: {
          collection: '["item1", "item2", "item3"]',
        },
      },
      function1: {
        id: 'function1',
        type: 'function',
        name: 'Function 1',
        position: { x: 0, y: 0 },
        subBlocks: {},
        outputs: {},
        enabled: true,
        data: {
          parentId: 'parallel1',
        },
      },
    }

    // Simulate parallel blocks structure (similar to loops)
    const parallels = {
      parallel1: {
        nodes: ['function1'],
        collection: '["item1", "item2", "item3"]',
      },
    }

    // Simulate the tag generation logic for parallel blocks
    const parallelTags: string[] = []
    const containingParallel = Object.entries(parallels).find(([_, parallel]) =>
      parallel.nodes.includes('function1')
    )

    if (containingParallel) {
      // Add parallel.index for all parallel blocks
      parallelTags.push('parallel.index')
      // Add parallel.currentItem and parallel.items
      parallelTags.push('parallel.currentItem')
      parallelTags.push('parallel.items')
    }

    // Verify all parallel tags are present
    expect(parallelTags).toContain('parallel.index')
    expect(parallelTags).toContain('parallel.currentItem')
    expect(parallelTags).toContain('parallel.items')
    expect(parallelTags).toHaveLength(3)
  })
})

describe('TagDropdown Variable Suggestions', () => {
  it.concurrent('should generate variable tags with correct format', () => {
    const variables = [
      { id: 'var1', name: 'User Name', type: 'string' },
      { id: 'var2', name: 'User Age', type: 'number' },
      { id: 'var3', name: 'Is Active', type: 'boolean' },
    ]

    // Simulate variable tag generation
    const variableTags = variables.map(
      (variable) => `variable.${variable.name.replace(/\s+/g, '')}`
    )

    expect(variableTags).toEqual(['variable.UserName', 'variable.UserAge', 'variable.IsActive'])
  })

  it.concurrent('should create variable info map correctly', () => {
    const variables = [
      { id: 'var1', name: 'User Name', type: 'string' },
      { id: 'var2', name: 'User Age', type: 'number' },
    ]

    // Simulate variable info map creation
    const variableInfoMap = variables.reduce(
      (acc, variable) => {
        const tagName = `variable.${variable.name.replace(/\s+/g, '')}`
        acc[tagName] = {
          type: variable.type,
          id: variable.id,
        }
        return acc
      },
      {} as Record<string, { type: string; id: string }>
    )

    expect(variableInfoMap).toEqual({
      'variable.UserName': { type: 'string', id: 'var1' },
      'variable.UserAge': { type: 'number', id: 'var2' },
    })
  })
})

describe('TagDropdown Search and Filtering', () => {
  it.concurrent('should extract search term from input correctly', () => {
    const testCases = [
      { input: 'Hello <var', cursorPosition: 10, expected: 'var' },
      { input: 'Hello <Variable.', cursorPosition: 16, expected: 'variable.' },
      { input: 'Hello <loop.in', cursorPosition: 14, expected: 'loop.in' },
      { input: 'Hello world', cursorPosition: 11, expected: '' },
      { input: 'Hello <var> and <loo', cursorPosition: 20, expected: 'loo' },
    ]

    testCases.forEach(({ input, cursorPosition, expected }) => {
      const textBeforeCursor = input.slice(0, cursorPosition)
      const match = textBeforeCursor.match(/<([^>]*)$/)
      const searchTerm = match ? match[1].toLowerCase() : ''

      expect(searchTerm).toBe(expected)
    })
  })

  it.concurrent('should filter tags based on search term', () => {
    const tags = [
      'variable.userName',
      'variable.userAge',
      'loop.index',
      'loop.currentItem',
      'parallel.index',
      'block.data',
    ]

    const searchTerm = 'user'
    const filteredTags = tags.filter((tag) => tag.toLowerCase().includes(searchTerm))

    expect(filteredTags).toEqual(['variable.userName', 'variable.userAge'])
  })

  it.concurrent('should group tags correctly by type', () => {
    const tags = [
      'variable.userName',
      'loop.index',
      'parallel.currentItem',
      'block.data',
      'variable.userAge',
      'loop.currentItem',
    ]

    const variableTags: string[] = []
    const loopTags: string[] = []
    const parallelTags: string[] = []
    const blockTags: string[] = []

    tags.forEach((tag) => {
      if (tag.startsWith('variable.')) {
        variableTags.push(tag)
      } else if (tag.startsWith('loop.')) {
        loopTags.push(tag)
      } else if (tag.startsWith('parallel.')) {
        parallelTags.push(tag)
      } else {
        blockTags.push(tag)
      }
    })

    expect(variableTags).toEqual(['variable.userName', 'variable.userAge'])
    expect(loopTags).toEqual(['loop.index', 'loop.currentItem'])
    expect(parallelTags).toEqual(['parallel.currentItem'])
    expect(blockTags).toEqual(['block.data'])
  })
})

describe('checkTagTrigger helper function', () => {
  it.concurrent('should return true when there is an unclosed < bracket', () => {
    const testCases = [
      { text: 'Hello <', cursorPosition: 7, expected: true },
      { text: 'Hello <var', cursorPosition: 10, expected: true },
      { text: 'Hello <variable.', cursorPosition: 16, expected: true },
    ]

    testCases.forEach(({ text, cursorPosition, expected }) => {
      const result = checkTagTrigger(text, cursorPosition)
      expect(result.show).toBe(expected)
    })
  })

  it.concurrent('should return false when there is no unclosed < bracket', () => {
    const testCases = [
      { text: 'Hello world', cursorPosition: 11, expected: false },
      { text: 'Hello <var>', cursorPosition: 11, expected: false },
      { text: 'Hello <var> and more', cursorPosition: 20, expected: false },
      { text: '', cursorPosition: 0, expected: false },
    ]

    testCases.forEach(({ text, cursorPosition, expected }) => {
      const result = checkTagTrigger(text, cursorPosition)
      expect(result.show).toBe(expected)
    })
  })

  it.concurrent('should handle edge cases correctly', () => {
    // Cursor at position 0
    expect(checkTagTrigger('Hello', 0).show).toBe(false)

    // Multiple brackets with unclosed one at the end
    expect(checkTagTrigger('Hello <var> and <loo', 20).show).toBe(true)

    // Multiple brackets all closed
    expect(checkTagTrigger('Hello <var> and <loop>', 22).show).toBe(false)
  })
})

describe('extractFieldsFromSchema helper function logic', () => {
  it.concurrent('should extract fields from JSON Schema format', () => {
    const responseFormat = {
      schema: {
        properties: {
          name: { type: 'string', description: 'User name' },
          age: { type: 'number', description: 'User age' },
          tags: { type: 'array', description: 'User tags' },
        },
      },
    }

    const fields = extractFieldsFromSchema(responseFormat)

    expect(fields).toEqual([
      { name: 'name', type: 'string', description: 'User name' },
      { name: 'age', type: 'number', description: 'User age' },
      { name: 'tags', type: 'array', description: 'User tags' },
    ])
  })

  it.concurrent('should handle direct schema format', () => {
    const responseFormat = {
      properties: {
        status: { type: 'boolean', description: 'Status flag' },
        data: { type: 'object', description: 'Response data' },
      },
    }

    const fields = extractFieldsFromSchema(responseFormat)

    expect(fields).toEqual([
      { name: 'status', type: 'boolean', description: 'Status flag' },
      { name: 'data', type: 'object', description: 'Response data' },
    ])
  })

  it.concurrent('should return empty array for invalid or missing schema', () => {
    expect(extractFieldsFromSchema(null)).toEqual([])
    expect(extractFieldsFromSchema(undefined)).toEqual([])
    expect(extractFieldsFromSchema({})).toEqual([])
    expect(extractFieldsFromSchema({ schema: null })).toEqual([])
    expect(extractFieldsFromSchema({ schema: { properties: null } })).toEqual([])
    expect(extractFieldsFromSchema('invalid')).toEqual([])
  })

  it.concurrent('should handle array properties correctly', () => {
    const responseFormat = {
      properties: {
        items: ['string', 'array'],
        name: { type: 'string' },
      },
    }

    const fields = extractFieldsFromSchema(responseFormat)

    expect(fields).toEqual([
      { name: 'items', type: 'array', description: undefined },
      { name: 'name', type: 'string', description: undefined },
    ])
  })

  it.concurrent('should default to string type when type is missing', () => {
    const responseFormat = {
      properties: {
        name: { description: 'User name' },
        age: { type: 'number' },
      },
    }

    const fields = extractFieldsFromSchema(responseFormat)

    expect(fields).toEqual([
      { name: 'name', type: 'string', description: 'User name' },
      { name: 'age', type: 'number', description: undefined },
    ])
  })

  it.concurrent('should handle flattened response format (new format)', () => {
    const responseFormat = {
      schema: {
        properties: {
          name: { type: 'string', description: 'User name' },
          age: { type: 'number', description: 'User age' },
          status: { type: 'boolean', description: 'Active status' },
        },
      },
    }

    const fields = extractFieldsFromSchema(responseFormat)

    expect(fields).toEqual([
      { name: 'name', type: 'string', description: 'User name' },
      { name: 'age', type: 'number', description: 'User age' },
      { name: 'status', type: 'boolean', description: 'Active status' },
    ])
  })
})

describe('TagDropdown Tag Ordering', () => {
  it.concurrent('should create ordered tags array in correct sequence', () => {
    const variableTags = ['variable.userName', 'variable.userAge']
    const loopTags = ['loop.index', 'loop.currentItem']
    const parallelTags = ['parallel.index']
    const blockTags = ['block.data']

    const orderedTags = [...variableTags, ...loopTags, ...parallelTags, ...blockTags]

    expect(orderedTags).toEqual([
      'variable.userName',
      'variable.userAge',
      'loop.index',
      'loop.currentItem',
      'parallel.index',
      'block.data',
    ])
  })

  it.concurrent('should create tag index map correctly', () => {
    const orderedTags = ['variable.userName', 'loop.index', 'block.data']

    const tagIndexMap = new Map<string, number>()
    orderedTags.forEach((tag, index) => {
      tagIndexMap.set(tag, index)
    })

    expect(tagIndexMap.get('variable.userName')).toBe(0)
    expect(tagIndexMap.get('loop.index')).toBe(1)
    expect(tagIndexMap.get('block.data')).toBe(2)
    expect(tagIndexMap.get('nonexistent')).toBeUndefined()
  })
})

describe('TagDropdown Tag Selection Logic', () => {
  it.concurrent('should handle existing closing bracket correctly when editing tags', () => {
    const testCases = [
      {
        description: 'should remove existing closing bracket from incomplete tag',
        inputValue: 'Hello <start.>',
        cursorPosition: 13, // cursor after the dot
        tag: 'start.input',
        expectedResult: 'Hello <start.input>',
      },
      {
        description: 'should remove existing closing bracket when replacing tag content',
        inputValue: 'Hello <start.input>',
        cursorPosition: 12, // cursor after 'start.'
        tag: 'start.data',
        expectedResult: 'Hello <start.data>',
      },
      {
        description: 'should preserve content after closing bracket',
        inputValue: 'Hello <start.> world',
        cursorPosition: 13,
        tag: 'start.input',
        expectedResult: 'Hello <start.input> world',
      },
      {
        description:
          'should not affect closing bracket if text between contains invalid characters',
        inputValue: 'Hello <start.input> and <other>',
        cursorPosition: 12,
        tag: 'start.data',
        expectedResult: 'Hello <start.data> and <other>',
      },
      {
        description: 'should handle case with no existing closing bracket',
        inputValue: 'Hello <start',
        cursorPosition: 12,
        tag: 'start.input',
        expectedResult: 'Hello <start.input>',
      },
    ]

    testCases.forEach(({ description, inputValue, cursorPosition, tag, expectedResult }) => {
      // Simulate the handleTagSelect logic
      const textBeforeCursor = inputValue.slice(0, cursorPosition)
      const textAfterCursor = inputValue.slice(cursorPosition)
      const lastOpenBracket = textBeforeCursor.lastIndexOf('<')

      // Apply the new logic for handling existing closing brackets
      const nextCloseBracket = textAfterCursor.indexOf('>')
      let remainingTextAfterCursor = textAfterCursor

      if (nextCloseBracket !== -1) {
        const textBetween = textAfterCursor.slice(0, nextCloseBracket)
        if (/^[a-zA-Z0-9._]*$/.test(textBetween)) {
          remainingTextAfterCursor = textAfterCursor.slice(nextCloseBracket + 1)
        }
      }

      const newValue = `${textBeforeCursor.slice(0, lastOpenBracket)}<${tag}>${remainingTextAfterCursor}`

      expect(newValue).toBe(expectedResult)
    })
  })

  it.concurrent('should validate tag-like character regex correctly', () => {
    const regex = /^[a-zA-Z0-9._]*$/

    // Valid tag-like text
    expect(regex.test('')).toBe(true) // empty string
    expect(regex.test('input')).toBe(true)
    expect(regex.test('content.data')).toBe(true)
    expect(regex.test('user_name')).toBe(true)
    expect(regex.test('item123')).toBe(true)
    expect(regex.test('content.data.item_1')).toBe(true)

    // Invalid tag-like text (should not remove closing bracket)
    expect(regex.test('input> and more')).toBe(false)
    expect(regex.test('content data')).toBe(false) // space
    expect(regex.test('user-name')).toBe(false) // hyphen
    expect(regex.test('data[')).toBe(false) // bracket
    expect(regex.test('content.data!')).toBe(false) // exclamation
  })

  it.concurrent('should find correct position of last open bracket', () => {
    const testCases = [
      { input: 'Hello <start', expected: 6 },
      { input: 'Hello <var> and <start', expected: 16 },
      { input: 'No brackets here', expected: -1 },
      { input: '<start', expected: 0 },
      { input: 'Multiple < < < <last', expected: 15 },
    ]

    testCases.forEach(({ input, expected }) => {
      const lastOpenBracket = input.lastIndexOf('<')
      expect(lastOpenBracket).toBe(expected)
    })
  })

  it.concurrent('should find correct position of next closing bracket', () => {
    const testCases = [
      { input: 'input>', expected: 5 },
      { input: 'content.data> more text', expected: 12 },
      { input: 'no closing bracket', expected: -1 },
      { input: '>', expected: 0 },
      { input: 'multiple > > > >last', expected: 9 },
    ]

    testCases.forEach(({ input, expected }) => {
      const nextCloseBracket = input.indexOf('>')
      expect(nextCloseBracket).toBe(expected)
    })
  })
})

describe('TagDropdown Response Format Support', () => {
  it.concurrent(
    'should use custom schema properties when response format is specified',
    async () => {
      // Mock the subblock store to return a custom response format
      const mockGetValue = vi.fn()
      const mockUseSubBlockStore = vi.mocked(
        await import('@/stores/workflows/subblock/store')
      ).useSubBlockStore

      // Set up the mock to return the example schema from the user
      const responseFormatValue = JSON.stringify({
        name: 'short_schema',
        description: 'A minimal example schema with a single string property.',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            example_property: {
              type: 'string',
              description: 'A simple string property.',
            },
          },
          additionalProperties: false,
          required: ['example_property'],
        },
      })

      mockGetValue.mockImplementation((blockId: string, subBlockId: string) => {
        if (blockId === 'agent1' && subBlockId === 'responseFormat') {
          return responseFormatValue
        }
        return null
      })

      mockUseSubBlockStore.mockReturnValue({
        getValue: mockGetValue,
        getState: () => ({
          getValue: mockGetValue,
        }),
      } as any)

      // Test the parseResponseFormatSafely function
      const parsedFormat = parseResponseFormatSafely(responseFormatValue, 'agent1')

      expect(parsedFormat).toEqual({
        name: 'short_schema',
        description: 'A minimal example schema with a single string property.',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            example_property: {
              type: 'string',
              description: 'A simple string property.',
            },
          },
          additionalProperties: false,
          required: ['example_property'],
        },
      })

      // Test the extractFieldsFromSchema function with the parsed format
      const fields = extractFieldsFromSchema(parsedFormat)

      expect(fields).toEqual([
        {
          name: 'example_property',
          type: 'string',
          description: 'A simple string property.',
        },
      ])
    }
  )

  it.concurrent(
    'should fallback to default outputs when response format parsing fails',
    async () => {
      // Test with invalid JSON
      const invalidFormat = parseResponseFormatSafely('invalid json', 'agent1')
      expect(invalidFormat).toBeNull()

      // Test with null/undefined values
      expect(parseResponseFormatSafely(null, 'agent1')).toBeNull()
      expect(parseResponseFormatSafely(undefined, 'agent1')).toBeNull()
      expect(parseResponseFormatSafely('', 'agent1')).toBeNull()
    }
  )

  it.concurrent('should handle response format with nested schema correctly', async () => {
    const responseFormat = {
      schema: {
        type: 'object',
        properties: {
          user: {
            type: 'object',
            description: 'User information',
            properties: {
              name: { type: 'string', description: 'User name' },
              age: { type: 'number', description: 'User age' },
            },
          },
          status: { type: 'string', description: 'Response status' },
        },
      },
    }

    const fields = extractFieldsFromSchema(responseFormat)

    expect(fields).toEqual([
      { name: 'user', type: 'object', description: 'User information' },
      { name: 'status', type: 'string', description: 'Response status' },
    ])
  })

  it.concurrent('should handle response format without schema wrapper', async () => {
    const responseFormat = {
      type: 'object',
      properties: {
        result: { type: 'boolean', description: 'Operation result' },
        message: { type: 'string', description: 'Status message' },
      },
    }

    const fields = extractFieldsFromSchema(responseFormat)

    expect(fields).toEqual([
      { name: 'result', type: 'boolean', description: 'Operation result' },
      { name: 'message', type: 'string', description: 'Status message' },
    ])
  })

  it.concurrent('should return object as-is when it is already parsed', async () => {
    const responseFormat = {
      name: 'test_schema',
      schema: {
        properties: {
          data: { type: 'string' },
        },
      },
    }

    const result = parseResponseFormatSafely(responseFormat, 'agent1')

    expect(result).toEqual(responseFormat)
  })

  it.concurrent('should simulate block tag generation with custom response format', async () => {
    // Simulate the tag generation logic that would happen in the component
    const blockName = 'Agent 1'
    const normalizedBlockName = blockName.replace(/\s+/g, '').toLowerCase() // 'agent1'

    // Mock response format
    const responseFormat = {
      schema: {
        properties: {
          example_property: { type: 'string', description: 'A simple string property.' },
          another_field: { type: 'number', description: 'Another field.' },
        },
      },
    }

    const schemaFields = extractFieldsFromSchema(responseFormat)

    // Generate block tags as they would be in the component
    const blockTags = schemaFields.map((field) => `${normalizedBlockName}.${field.name}`)

    expect(blockTags).toEqual(['agent1.example_property', 'agent1.another_field'])

    // Verify the fields extracted correctly
    expect(schemaFields).toEqual([
      { name: 'example_property', type: 'string', description: 'A simple string property.' },
      { name: 'another_field', type: 'number', description: 'Another field.' },
    ])
  })
})

describe('TagDropdown Type Display Functionality', () => {
  it.concurrent(
    'should extract types correctly from tool outputs using generateOutputPathsWithTypes',
    () => {
      // Test with Exa search tool outputs
      const exaSearchOutputs = {
        results: {
          type: 'array',
          description: 'Search results with titles, URLs, and text snippets',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'The title of the search result' },
              url: { type: 'string', description: 'The URL of the search result' },
              score: { type: 'number', description: 'Relevance score for the search result' },
            },
          },
        },
      }

      // Mock the generateOutputPathsWithTypes function behavior
      const generateOutputPathsWithTypes = (
        outputs: Record<string, any>,
        prefix = ''
      ): Array<{ path: string; type: string }> => {
        const paths: Array<{ path: string; type: string }> = []

        for (const [key, output] of Object.entries(outputs)) {
          const currentPath = prefix ? `${prefix}.${key}` : key
          if (output && typeof output === 'object' && 'type' in output) {
            paths.push({ path: currentPath, type: output.type as string })

            // Handle nested properties
            if ((output as any).properties) {
              const nestedPaths = generateOutputPathsWithTypes(
                (output as any).properties,
                currentPath
              )
              paths.push(...nestedPaths)
            }

            // Handle array items properties
            if ((output as any).items?.properties) {
              const itemPaths = generateOutputPathsWithTypes(
                (output as any).items.properties,
                currentPath
              )
              paths.push(...itemPaths)
            }
          }
        }

        return paths
      }

      const paths = generateOutputPathsWithTypes(exaSearchOutputs)

      expect(paths).toEqual([
        { path: 'results', type: 'array' },
        { path: 'results.title', type: 'string' },
        { path: 'results.url', type: 'string' },
        { path: 'results.score', type: 'number' },
      ])
    }
  )

  it.concurrent('should extract types correctly for complex nested structures', () => {
    // Test with Pinecone tool outputs
    const pineconeOutputs = {
      matches: {
        type: 'array',
        description: 'Search results with ID, score, and metadata',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Vector ID' },
            score: { type: 'number', description: 'Similarity score' },
            metadata: { type: 'object', description: 'Associated metadata' },
          },
        },
      },
      usage: {
        type: 'object',
        description: 'Usage statistics including tokens, read units, and rerank units',
        properties: {
          total_tokens: { type: 'number', description: 'Total tokens used for embedding' },
          read_units: { type: 'number', description: 'Read units consumed' },
          rerank_units: { type: 'number', description: 'Rerank units used' },
        },
      },
    }

    const generateOutputPathsWithTypes = (
      outputs: Record<string, any>,
      prefix = ''
    ): Array<{ path: string; type: string }> => {
      const paths: Array<{ path: string; type: string }> = []

      for (const [key, output] of Object.entries(outputs)) {
        const currentPath = prefix ? `${prefix}.${key}` : key
        if (output && typeof output === 'object' && 'type' in output) {
          paths.push({ path: currentPath, type: output.type as string })

          if ((output as any).properties) {
            const nestedPaths = generateOutputPathsWithTypes(
              (output as any).properties,
              currentPath
            )
            paths.push(...nestedPaths)
          }

          if ((output as any).items?.properties) {
            const itemPaths = generateOutputPathsWithTypes(
              (output as any).items.properties,
              currentPath
            )
            paths.push(...itemPaths)
          }
        }
      }

      return paths
    }

    const paths = generateOutputPathsWithTypes(pineconeOutputs)

    expect(paths).toEqual([
      { path: 'matches', type: 'array' },
      { path: 'matches.id', type: 'string' },
      { path: 'matches.score', type: 'number' },
      { path: 'matches.metadata', type: 'object' },
      { path: 'usage', type: 'object' },
      { path: 'usage.total_tokens', type: 'number' },
      { path: 'usage.read_units', type: 'number' },
      { path: 'usage.rerank_units', type: 'number' },
    ])
  })

  it.concurrent('should get tool output type for specific paths using getToolOutputType', () => {
    // Mock block configuration for Exa
    const blockConfig = {
      tools: {
        config: {
          tool: ({ operation }: { operation: string }) => `exa_${operation}`,
        },
      },
    }

    // Mock getToolOutputType function behavior
    const getToolOutputType = (blockConfig: any, operation: string, path: string): string => {
      // Get tool ID from block config
      const toolId = blockConfig?.tools?.config?.tool?.({ operation })
      if (!toolId) return ''

      // Mock tool lookup (would use getTool in real implementation)
      const mockTools: Record<string, any> = {
        exa_search: {
          outputs: {
            results: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  url: { type: 'string' },
                  score: { type: 'number' },
                },
              },
            },
          },
        },
      }

      const tool = mockTools[toolId]
      if (!tool?.outputs) return ''

      // Navigate to the specific path
      const pathParts = path.split('.')
      let current = tool.outputs

      for (const part of pathParts) {
        if (!current[part]) {
          // Check if we're looking at array items
          if (current.items?.properties?.[part]) {
            current = current.items.properties
          } else {
            return ''
          }
        }
        current = current[part]
      }

      return current?.type || ''
    }

    // Test various path types
    expect(getToolOutputType(blockConfig, 'search', 'results')).toBe('array')
    expect(getToolOutputType(blockConfig, 'search', 'results.title')).toBe('string')
    expect(getToolOutputType(blockConfig, 'search', 'results.url')).toBe('string')
    expect(getToolOutputType(blockConfig, 'search', 'results.score')).toBe('number')
    expect(getToolOutputType(blockConfig, 'search', 'nonexistent')).toBe('')
  })

  it.concurrent('should generate tool output paths with type information', () => {
    // Mock the generateToolOutputPaths function that returns both path and type
    const generateToolOutputPaths = (
      blockConfig: any,
      operation: string
    ): Array<{ path: string; type: string }> => {
      const toolId = blockConfig?.tools?.config?.tool?.({ operation })
      if (!toolId) return []

      // Mock tool configurations
      const mockTools: Record<string, any> = {
        exa_search: {
          outputs: {
            results: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  url: { type: 'string' },
                  score: { type: 'number' },
                },
              },
            },
          },
        },
      }

      const tool = mockTools[toolId]
      if (!tool?.outputs) return []

      const paths: Array<{ path: string; type: string }> = []

      const traverse = (obj: any, prefix = '') => {
        for (const [key, value] of Object.entries(obj)) {
          const currentPath = prefix ? `${prefix}.${key}` : key
          if (value && typeof value === 'object' && 'type' in value) {
            paths.push({ path: currentPath, type: (value as any).type })

            if ((value as any).properties) {
              traverse((value as any).properties, currentPath)
            }

            if ((value as any).items?.properties) {
              traverse((value as any).items.properties, currentPath)
            }
          }
        }
      }

      traverse(tool.outputs)
      return paths
    }

    const blockConfig = {
      tools: {
        config: {
          tool: ({ operation }: { operation: string }) => `exa_${operation}`,
        },
      },
    }

    const paths = generateToolOutputPaths(blockConfig, 'search')

    expect(paths).toEqual([
      { path: 'results', type: 'array' },
      { path: 'results.title', type: 'string' },
      { path: 'results.url', type: 'string' },
      { path: 'results.score', type: 'number' },
    ])
  })

  it.concurrent('should handle missing or invalid tool configurations gracefully', () => {
    const getToolOutputType = (blockConfig: any, operation: string, path: string): string => {
      try {
        const toolId = blockConfig?.tools?.config?.tool?.({ operation })
        if (!toolId) return ''

        // Mock empty tool configurations
        const mockTools: Record<string, any> = {}
        const tool = mockTools[toolId]
        if (!tool?.outputs) return ''

        return ''
      } catch (error) {
        return ''
      }
    }

    // Test with null/undefined block config
    expect(getToolOutputType(null, 'search', 'results')).toBe('')
    expect(getToolOutputType(undefined, 'search', 'results')).toBe('')
    expect(getToolOutputType({}, 'search', 'results')).toBe('')

    // Test with invalid block config structure
    const invalidBlockConfig = { tools: null }
    expect(getToolOutputType(invalidBlockConfig, 'search', 'results')).toBe('')

    // Test with missing tool function
    const incompleteBlockConfig = {
      tools: {
        config: {},
      },
    }
    expect(getToolOutputType(incompleteBlockConfig, 'search', 'results')).toBe('')
  })

  it.concurrent(
    'should only show types when reliable data is available from tool configuration',
    () => {
      // Mock tag info creation that only includes type when available
      const createTagInfo = (
        blockConfig: any,
        operation: string,
        path: string
      ): { type?: string; description?: string } => {
        const getToolOutputType = (blockConfig: any, operation: string, path: string): string => {
          const toolId = blockConfig?.tools?.config?.tool?.({ operation })
          if (!toolId) return ''

          const mockTools: Record<string, any> = {
            exa_search: {
              outputs: {
                results: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      title: { type: 'string' },
                    },
                  },
                },
              },
            },
          }

          const tool = mockTools[toolId]
          if (!tool?.outputs) return ''

          const pathParts = path.split('.')
          let current = tool.outputs

          for (const part of pathParts) {
            if (!current[part]) {
              if ((current as any).items?.properties?.[part]) {
                current = (current as any).items.properties
              } else {
                return ''
              }
            }
            current = current[part]
          }

          return (current as any)?.type || ''
        }

        const type = getToolOutputType(blockConfig, operation, path)

        // Only return type information if we have reliable data
        if (type) {
          return { type }
        }

        return {}
      }

      const blockConfig = {
        tools: {
          config: {
            tool: ({ operation }: { operation: string }) => `exa_${operation}`,
          },
        },
      }

      // Should have type for valid paths
      expect(createTagInfo(blockConfig, 'search', 'results')).toEqual({ type: 'array' })
      expect(createTagInfo(blockConfig, 'search', 'results.title')).toEqual({ type: 'string' })

      // Should not have type for invalid paths
      expect(createTagInfo(blockConfig, 'search', 'nonexistent')).toEqual({})
      expect(createTagInfo(blockConfig, 'invalid_operation', 'results')).toEqual({})
      expect(createTagInfo(null, 'search', 'results')).toEqual({})
    }
  )

  it.concurrent('should handle deeply nested structures correctly', () => {
    // Test with Notion query_database tool structure
    const notionOutputs = {
      content: {
        type: 'string',
        description: 'Formatted list of database entries with their properties',
      },
      metadata: {
        type: 'object',
        description:
          'Query metadata including total results count, pagination info, and raw results array',
        properties: {
          totalResults: { type: 'number', description: 'Number of results returned' },
          hasMore: { type: 'boolean', description: 'Whether more results are available' },
          results: {
            type: 'array',
            description: 'Raw Notion page objects',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Page ID' },
                properties: { type: 'object', description: 'Page properties' },
              },
            },
          },
        },
      },
    }

    const generateOutputPathsWithTypes = (
      outputs: Record<string, any>,
      prefix = ''
    ): Array<{ path: string; type: string }> => {
      const paths: Array<{ path: string; type: string }> = []

      for (const [key, output] of Object.entries(outputs)) {
        const currentPath = prefix ? `${prefix}.${key}` : key
        if (output && typeof output === 'object' && 'type' in output) {
          paths.push({ path: currentPath, type: output.type as string })

          if ((output as any).properties) {
            const nestedPaths = generateOutputPathsWithTypes(
              (output as any).properties,
              currentPath
            )
            paths.push(...nestedPaths)
          }

          if ((output as any).items?.properties) {
            const itemPaths = generateOutputPathsWithTypes(
              (output as any).items.properties,
              currentPath
            )
            paths.push(...itemPaths)
          }
        }
      }

      return paths
    }

    const paths = generateOutputPathsWithTypes(notionOutputs)

    expect(paths).toEqual([
      { path: 'content', type: 'string' },
      { path: 'metadata', type: 'object' },
      { path: 'metadata.totalResults', type: 'number' },
      { path: 'metadata.hasMore', type: 'boolean' },
      { path: 'metadata.results', type: 'array' },
      { path: 'metadata.results.id', type: 'string' },
      { path: 'metadata.results.properties', type: 'object' },
    ])
  })
})

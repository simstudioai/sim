import { Mem0Icon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { Mem0Response } from '@/tools/mem0/types'

export const Mem0Block: BlockConfig<Mem0Response> = {
  type: 'mem0',
  name: 'Mem0',
  description: 'Agent memory management',
  longDescription:
    'Add, search, retrieve, and delete memories using Mem0. Store conversation history, user preferences, and context across workflow executions for enhanced AI agent capabilities.',
  bgColor: '#181C1E',
  icon: Mem0Icon,
  category: 'tools',
  docsLink: 'https://docs.sim.ai/tools/mem0',
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      layout: 'half',
      options: [
        { label: 'Add Memories', id: 'add' },
        { label: 'Search Memories', id: 'search' },
        { label: 'Get Memories', id: 'get' },
      ],
      placeholder: 'Select an operation',
      value: () => 'add',
    },
    {
      id: 'userId',
      title: 'User ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter user identifier',
      value: () => 'userid', // Default to the working user ID from curl example
      required: true,
    },
    {
      id: 'messages',
      title: 'Messages',
      type: 'code',
      layout: 'full',
      placeholder: 'JSON array, e.g. [{"role": "user", "content": "I love Sim!"}]',
      language: 'json',
      condition: {
        field: 'operation',
        value: 'add',
      },
      required: true,
    },
    {
      id: 'query',
      title: 'Search Query',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter search query to find relevant memories',
      condition: {
        field: 'operation',
        value: 'search',
      },
      required: true,
    },
    {
      id: 'memoryId',
      title: 'Memory ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Specific memory ID to retrieve',
      condition: {
        field: 'operation',
        value: 'get',
      },
    },
    {
      id: 'startDate',
      title: 'Start Date',
      type: 'short-input',
      layout: 'half',
      placeholder: 'YYYY-MM-DD',
      condition: {
        field: 'operation',
        value: 'get',
      },
    },
    {
      id: 'endDate',
      title: 'End Date',
      type: 'short-input',
      layout: 'half',
      placeholder: 'YYYY-MM-DD',
      condition: {
        field: 'operation',
        value: 'get',
      },
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter your Mem0 API key',
      password: true,
      required: true,
    },
    {
      id: 'limit',
      title: 'Result Limit',
      type: 'slider',
      layout: 'full',
      min: 1,
      max: 50,
      step: 1,
      integer: true,
      condition: {
        field: 'operation',
        value: ['search', 'get'],
      },
    },
  ],
  tools: {
    access: ['mem0_add_memories', 'mem0_search_memories', 'mem0_get_memories'],
    config: {
      tool: (params: Record<string, any>) => {
        const operation = params.operation || 'add'
        switch (operation) {
          case 'add':
            return 'mem0_add_memories'
          case 'search':
            return 'mem0_search_memories'
          case 'get':
            return 'mem0_get_memories'
          default:
            return 'mem0_add_memories'
        }
      },
      params: (params: Record<string, any>) => {
        // Create detailed error information for any missing required fields
        const errors: string[] = []

        // Validate required API key for all operations
        if (!params.apiKey) {
          errors.push('API Key is required')
        }

        // For search operation, validate required fields
        if (params.operation === 'search') {
          if (!params.query || params.query.trim() === '') {
            errors.push('Search Query is required')
          }

          if (!params.userId) {
            errors.push('User ID is required')
          }
        }

        // For add operation, validate required fields
        if (params.operation === 'add') {
          if (!params.messages) {
            errors.push('Messages are required for add operation')
          } else {
            try {
              const messagesArray =
                typeof params.messages === 'string' ? JSON.parse(params.messages) : params.messages

              if (!Array.isArray(messagesArray) || messagesArray.length === 0) {
                errors.push('Messages must be a non-empty array')
              } else {
                for (const msg of messagesArray) {
                  if (!msg.role || !msg.content) {
                    errors.push("Each message must have 'role' and 'content' properties")
                    break
                  }
                }
              }
            } catch (_e: any) {
              errors.push('Messages must be valid JSON')
            }
          }

          if (!params.userId) {
            errors.push('User ID is required')
          }
        }

        // Throw error if any required fields are missing
        if (errors.length > 0) {
          throw new Error(`Mem0 Block Error: ${errors.join(', ')}`)
        }

        const result: Record<string, any> = {
          apiKey: params.apiKey,
        }

        // Add any identifiers that are present
        if (params.userId) result.userId = params.userId

        // Add version if specified
        if (params.version) result.version = params.version

        if (params.limit) result.limit = params.limit

        const operation = params.operation || 'add'

        // Process operation-specific parameters
        switch (operation) {
          case 'add':
            if (params.messages) {
              try {
                // Ensure messages are properly formatted
                const messagesArray =
                  typeof params.messages === 'string'
                    ? JSON.parse(params.messages)
                    : params.messages

                // Validate message structure
                if (Array.isArray(messagesArray) && messagesArray.length > 0) {
                  let validMessages = true
                  for (const msg of messagesArray) {
                    if (!msg.role || !msg.content) {
                      validMessages = false
                      break
                    }
                  }
                  if (validMessages) {
                    result.messages = messagesArray
                  } else {
                    // Consistent with other error handling - collect in errors array
                    errors.push('Invalid message format - each message must have role and content')
                    throw new Error(
                      'Mem0 Block Error: Invalid message format - each message must have role and content'
                    )
                  }
                } else {
                  // Consistent with other error handling
                  errors.push('Messages must be a non-empty array')
                  throw new Error('Mem0 Block Error: Messages must be a non-empty array')
                }
              } catch (e: any) {
                if (!errors.includes('Messages must be valid JSON')) {
                  errors.push('Messages must be valid JSON')
                }
                throw new Error(`Mem0 Block Error: ${e.message || 'Messages must be valid JSON'}`)
              }
            }
            break
          case 'search':
            if (params.query) {
              result.query = params.query

              // Check if we have at least one identifier for search
              if (!params.userId) {
                errors.push('Search requires a User ID')
                throw new Error('Mem0 Block Error: Search requires a User ID')
              }
            } else {
              errors.push('Search requires a query parameter')
              throw new Error('Mem0 Block Error: Search requires a query parameter')
            }

            // Include limit if specified
            if (params.limit) {
              result.limit = Number(params.limit)
            }
            break
          case 'get':
            if (params.memoryId) {
              result.memoryId = params.memoryId
            }

            // Add date range filtering for v2 get memories
            if (params.startDate) {
              result.startDate = params.startDate
            }

            if (params.endDate) {
              result.endDate = params.endDate
            }
            break
        }

        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Mem0 API key' },
    userId: { type: 'string', description: 'User identifier' },
    version: { type: 'string', description: 'API version' },
    messages: { type: 'json', description: 'Message data array' },
    query: { type: 'string', description: 'Search query' },
    memoryId: { type: 'string', description: 'Memory identifier' },
    startDate: { type: 'string', description: 'Start date filter' },
    endDate: { type: 'string', description: 'End date filter' },
    limit: { type: 'number', description: 'Result limit' },
  },
  outputs: {
    ids: { type: 'any', description: 'Memory identifiers' },
    memories: { type: 'any', description: 'Memory data' },
    searchResults: { type: 'any', description: 'Search results' },
  },
}

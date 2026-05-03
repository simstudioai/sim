import { toError } from '@sim/utils/errors'
import { Mem0Icon } from '@/components/icons'
import { AuthMode, type BlockConfig, IntegrationType } from '@/blocks/types'
import type { Mem0Response } from '@/tools/mem0/types'
import { parseMem0Messages } from '@/tools/mem0/utils'

export const Mem0Block: BlockConfig<Mem0Response> = {
  type: 'mem0',
  name: 'Mem0',
  description: 'Agent memory management',
  authMode: AuthMode.ApiKey,
  longDescription: 'Integrate Mem0 into the workflow. Can add, search, and retrieve memories.',
  bgColor: '#181C1E',
  icon: Mem0Icon,
  category: 'tools',
  integrationType: IntegrationType.AI,
  tags: ['llm', 'knowledge-base', 'agentic'],
  docsLink: 'https://docs.sim.ai/tools/mem0',
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
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
      placeholder: 'Enter user identifier',
      required: true,
    },
    {
      id: 'messages',
      title: 'Messages',
      type: 'code',
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
      placeholder: 'YYYY-MM-DD',
      condition: {
        field: 'operation',
        value: 'get',
      },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate a date in YYYY-MM-DD format based on the user's description.
Examples:
- "last week" -> Calculate 7 days ago
- "beginning of this month" -> First day of current month
- "30 days ago" -> Calculate 30 days ago
- "start of year" -> January 1 of current year

Return ONLY the date string in YYYY-MM-DD format - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the start date (e.g., "last week", "30 days ago")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'endDate',
      title: 'End Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      condition: {
        field: 'operation',
        value: 'get',
      },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate a date in YYYY-MM-DD format based on the user's description.
Examples:
- "today" -> Today's date
- "yesterday" -> Yesterday's date
- "end of last week" -> Last Sunday's date
- "now" -> Today's date

Return ONLY the date string in YYYY-MM-DD format - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe the end date (e.g., "today", "yesterday")...',
        generationType: 'timestamp',
      },
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Mem0 API key',
      password: true,
      required: true,
    },
    {
      id: 'page',
      title: 'Page',
      type: 'short-input',
      placeholder: '1',
      condition: {
        field: 'operation',
        value: 'get',
      },
      mode: 'advanced',
    },
    {
      id: 'limit',
      title: 'Result Limit',
      type: 'slider',
      min: 1,
      max: 50,
      step: 1,
      integer: true,
      condition: {
        field: 'operation',
        value: ['search', 'get'],
      },
      mode: 'advanced',
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
        const errors: string[] = []
        const operation = params.operation || 'add'

        if (!params.apiKey) {
          errors.push('API Key is required')
        }

        if (operation === 'search') {
          if (!params.query || params.query.trim() === '') {
            errors.push('Search Query is required')
          }

          if (!params.userId) {
            errors.push('User ID is required')
          }
        }

        if (operation === 'add') {
          if (!params.userId) {
            errors.push('User ID is required')
          }
        }

        if (errors.length > 0) {
          throw new Error(`Mem0 Block Error: ${errors.join(', ')}`)
        }

        const result: Record<string, any> = {
          apiKey: params.apiKey,
        }

        if (params.userId) result.userId = params.userId

        if (params.limit) result.limit = Number(params.limit)

        switch (operation) {
          case 'add':
            try {
              result.messages = parseMem0Messages(params.messages)
            } catch (error) {
              throw new Error(`Mem0 Block Error: ${toError(error).message}`)
            }
            break
          case 'search':
            if (params.query) {
              result.query = params.query

              if (!params.userId) {
                errors.push('Search requires a User ID')
                throw new Error('Mem0 Block Error: Search requires a User ID')
              }
            } else {
              errors.push('Search requires a query parameter')
              throw new Error('Mem0 Block Error: Search requires a query parameter')
            }

            break
          case 'get':
            if (params.memoryId) {
              result.memoryId = params.memoryId
            }

            if (params.page) {
              result.page = Number(params.page)
            }

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
    messages: { type: 'json', description: 'Message data array' },
    query: { type: 'string', description: 'Search query' },
    memoryId: { type: 'string', description: 'Memory identifier' },
    startDate: { type: 'string', description: 'Start date filter' },
    endDate: { type: 'string', description: 'End date filter' },
    page: { type: 'number', description: 'Page number for paginated get results' },
    limit: { type: 'number', description: 'Result limit' },
  },
  outputs: {
    ids: { type: 'json', description: 'Memory identifiers returned by search or get operations' },
    memories: { type: 'json', description: 'Memory records returned by get operations' },
    searchResults: { type: 'json', description: 'Ranked memory records returned by search' },
    message: { type: 'string', description: 'Add operation status message' },
    status: { type: 'string', description: 'Add operation processing status' },
    event_id: { type: 'string', description: 'Add operation event ID for status polling' },
    count: { type: 'number', description: 'Total memory count for get operations' },
    next: { type: 'string', description: 'Next page URL for get operations' },
    previous: { type: 'string', description: 'Previous page URL for get operations' },
  },
}

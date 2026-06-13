import { toError } from '@sim/utils/errors'
import { Mem0Icon } from '@/components/icons'
import { AuthMode, type BlockConfig, type BlockMeta, IntegrationType } from '@/blocks/types'
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
  docsLink: 'https://docs.sim.ai/integrations/mem0',
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

export const Mem0BlockMeta = {
  tags: ['llm', 'knowledge-base', 'agentic'],
  url: 'https://mem0.ai',
  templates: [
    {
      icon: Mem0Icon,
      title: 'Mem0 long-term agent memory',
      prompt:
        'Build an agent that uses Mem0 to remember user preferences and prior conversations across sessions, so follow-up requests reference real history instead of starting from scratch.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['individual', 'automation'],
    },
    {
      icon: Mem0Icon,
      title: 'Mem0 sales-assistant memory',
      prompt:
        'Create a sales agent that persists per-account context in Mem0 — last call notes, open objections, agreed next steps — so every rep starts a follow-up call already up to speed.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'crm'],
    },
    {
      icon: Mem0Icon,
      title: 'Mem0 + Zep hybrid memory agent',
      prompt:
        'Create a chat agent that uses Mem0 for persistent user preferences and Zep for in-session continuity, so the agent recalls long-term context while staying coherent turn-to-turn.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['individual', 'automation'],
      alsoIntegrations: ['zep'],
    },
    {
      icon: Mem0Icon,
      title: 'Mem0 + Slack assistant memory',
      prompt:
        'Build a Slack bot that uses Mem0 to remember user preferences and prior conversations, so each follow-up question lands in context instead of starting fresh.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'communication'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: Mem0Icon,
      title: 'Mem0 + Notion personal-knowledge agent',
      prompt:
        'Create an agent that uses Mem0 to recall personal context and Notion as the source-of-truth knowledge base, answering questions with citations plus user-specific memory.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['individual', 'research'],
      alsoIntegrations: ['notion'],
    },
    {
      icon: Mem0Icon,
      title: 'Mem0 customer-preference store',
      prompt:
        'Build a workflow that captures customer preferences from support interactions into Mem0 keyed by account, so future automations reference the real preferences.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['support', 'crm'],
      alsoIntegrations: ['zendesk'],
    },
    {
      icon: Mem0Icon,
      title: 'Mem0 onboarding-context agent',
      prompt:
        'Create an onboarding agent that adds each new user’s role, goals, and stack to Mem0 on first contact, then searches that memory on every later session so guidance stays tailored to the individual instead of generic.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['individual', 'automation', 'onboarding'],
    },
  ],
  skills: [
    {
      name: 'remember-user-context',
      description:
        'Store new facts and preferences for a user in Mem0 from the latest conversation.',
      content:
        '# Remember User Context\n\nPersist what you learned about a user so future sessions stay informed.\n\n## Steps\n1. Identify the user ID this memory belongs to.\n2. Build the messages array from the relevant conversation turns as role and content objects.\n3. Add Memories with the user ID and messages so Mem0 extracts and stores the durable facts.\n\n## Output\nConfirmation the memories were added for the user, with the IDs of the facts created.',
    },
    {
      name: 'recall-relevant-memories',
      description:
        "Search a user's Mem0 memories for the facts relevant to the current request before answering.",
      content:
        '# Recall Relevant Memories\n\nGround a response in what Mem0 already knows about the user.\n\n## Steps\n1. Identify the user ID.\n2. Phrase a search query that captures the current request or topic.\n3. Search Memories with the user ID and query.\n4. Use the returned memories as context when drafting the answer.\n\n## Output\nThe most relevant memories for the user and a note of how they should shape the response.',
    },
    {
      name: 'review-stored-memories',
      description:
        "Retrieve a user's stored Mem0 memories, optionally within a date range, to audit what is known.",
      content:
        "# Review Stored Memories\n\nInspect what Mem0 holds for a user.\n\n## Steps\n1. Identify the user ID.\n2. Get Memories for that user, optionally bounding by a start and end date or a specific memory ID.\n3. Page through results if there are many.\n4. Summarize the stored facts and flag anything stale or contradictory.\n\n## Output\nA readable list of the user's stored memories with a short summary and any items worth updating.",
    },
  ],
} as const satisfies BlockMeta

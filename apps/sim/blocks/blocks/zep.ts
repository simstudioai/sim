import { ZepIcon } from '@/components/icons'
import { AuthMode, type BlockConfig } from '@/blocks/types'
import type { ZepResponse } from '@/tools/zep/types'

export const ZepBlock: BlockConfig<ZepResponse> = {
  type: 'zep',
  name: 'Zep',
  description: 'Long-term memory for AI agents',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Zep for long-term memory management. Create threads, add messages, retrieve context with AI-powered summaries and facts extraction.',
  bgColor: '#E8E8E8',
  icon: ZepIcon,
  category: 'tools',
  docsLink: 'https://docs.sim.ai/tools/zep',
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Create Thread', id: 'create_thread' },
        { label: 'Add Messages', id: 'add_messages' },
        { label: 'Get Context', id: 'get_context' },
        { label: 'Get Messages', id: 'get_messages' },
        { label: 'Get Threads', id: 'get_threads' },
        { label: 'Delete Thread', id: 'delete_thread' },
        { label: 'Add User', id: 'add_user' },
        { label: 'Get User', id: 'get_user' },
        { label: 'Get User Threads', id: 'get_user_threads' },
      ],
      placeholder: 'Select an operation',
      value: () => 'create_thread',
    },
    {
      id: 'threadId',
      title: 'Thread ID',
      type: 'short-input',
      placeholder: 'Enter unique thread identifier',
      condition: {
        field: 'operation',
        value: ['create_thread', 'add_messages', 'get_context', 'get_messages', 'delete_thread'],
      },
      required: true,
    },
    {
      id: 'userId',
      title: 'User ID',
      type: 'short-input',
      placeholder: 'Enter user identifier',
      condition: {
        field: 'operation',
        value: ['create_thread', 'add_user', 'get_user', 'get_user_threads'],
      },
      required: true,
    },
    {
      id: 'email',
      title: 'Email',
      type: 'short-input',
      placeholder: 'user@example.com',
      condition: {
        field: 'operation',
        value: 'add_user',
      },
    },
    {
      id: 'firstName',
      title: 'First Name',
      type: 'short-input',
      placeholder: 'John',
      condition: {
        field: 'operation',
        value: 'add_user',
      },
    },
    {
      id: 'lastName',
      title: 'Last Name',
      type: 'short-input',
      placeholder: 'Doe',
      condition: {
        field: 'operation',
        value: 'add_user',
      },
    },
    {
      id: 'metadata',
      title: 'Metadata',
      type: 'code',
      placeholder: '{"key": "value"}',
      language: 'json',
      condition: {
        field: 'operation',
        value: 'add_user',
      },
    },
    {
      id: 'messages',
      title: 'Messages',
      type: 'code',
      placeholder: '[{"role": "user", "content": "Hello!"}]',
      language: 'json',
      condition: {
        field: 'operation',
        value: 'add_messages',
      },
      required: true,
    },
    {
      id: 'mode',
      title: 'Context Mode',
      type: 'dropdown',
      options: [
        { label: 'Summary (Natural Language)', id: 'summary' },
        { label: 'Basic (Raw Facts)', id: 'basic' },
      ],
      placeholder: 'Select context mode',
      value: () => 'summary',
      condition: {
        field: 'operation',
        value: 'get_context',
      },
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Zep API key',
      password: true,
      required: true,
    },
    {
      id: 'limit',
      title: 'Result Limit',
      type: 'slider',
      min: 1,
      max: 100,
      step: 1,
      integer: true,
      condition: {
        field: 'operation',
        value: ['get_messages', 'get_threads'],
      },
    },
  ],
  tools: {
    access: [
      'zep_create_thread',
      'zep_get_threads',
      'zep_delete_thread',
      'zep_get_context',
      'zep_get_messages',
      'zep_add_messages',
      'zep_add_user',
      'zep_get_user',
      'zep_get_user_threads',
    ],
    config: {
      tool: (params: Record<string, any>) => {
        const operation = params.operation || 'create_thread'
        switch (operation) {
          case 'create_thread':
            return 'zep_create_thread'
          case 'add_messages':
            return 'zep_add_messages'
          case 'get_context':
            return 'zep_get_context'
          case 'get_messages':
            return 'zep_get_messages'
          case 'get_threads':
            return 'zep_get_threads'
          case 'delete_thread':
            return 'zep_delete_thread'
          case 'add_user':
            return 'zep_add_user'
          case 'get_user':
            return 'zep_get_user'
          case 'get_user_threads':
            return 'zep_get_user_threads'
          default:
            return 'zep_create_thread'
        }
      },
      params: (params: Record<string, any>) => {
        const errors: string[] = []

        // Validate required API key for all operations
        if (!params.apiKey) {
          errors.push('API Key is required')
        }

        const operation = params.operation || 'create_thread'

        // Validate operation-specific required fields
        if (
          [
            'create_thread',
            'add_messages',
            'get_context',
            'get_messages',
            'delete_thread',
          ].includes(operation)
        ) {
          if (!params.threadId) {
            errors.push('Thread ID is required')
          }
        }

        if (operation === 'create_thread' || operation === 'add_user') {
          if (!params.userId) {
            errors.push('User ID is required')
          }
        }

        if (operation === 'get_user' || operation === 'get_user_threads') {
          if (!params.userId) {
            errors.push('User ID is required')
          }
        }

        if (operation === 'add_messages') {
          if (!params.messages) {
            errors.push('Messages are required')
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
        }

        // Throw error if any required fields are missing
        if (errors.length > 0) {
          throw new Error(`Zep Block Error: ${errors.join(', ')}`)
        }

        // Build the result params
        const result: Record<string, any> = {
          apiKey: params.apiKey,
        }

        if (params.threadId) result.threadId = params.threadId
        if (params.userId) result.userId = params.userId
        if (params.mode) result.mode = params.mode
        if (params.limit) result.limit = Number(params.limit)
        if (params.email) result.email = params.email
        if (params.firstName) result.firstName = params.firstName
        if (params.lastName) result.lastName = params.lastName
        if (params.metadata) result.metadata = params.metadata

        // Add messages for add operation
        if (operation === 'add_messages') {
          if (params.messages) {
            try {
              const messagesArray =
                typeof params.messages === 'string' ? JSON.parse(params.messages) : params.messages
              result.messages = messagesArray
            } catch (e: any) {
              throw new Error(`Zep Block Error: ${e.message || 'Messages must be valid JSON'}`)
            }
          }
        }

        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Zep API key' },
    threadId: { type: 'string', description: 'Thread identifier' },
    userId: { type: 'string', description: 'User identifier' },
    messages: { type: 'json', description: 'Message data array' },
    mode: { type: 'string', description: 'Context mode (summary or basic)' },
    limit: { type: 'number', description: 'Result limit' },
    email: { type: 'string', description: 'User email' },
    firstName: { type: 'string', description: 'User first name' },
    lastName: { type: 'string', description: 'User last name' },
    metadata: { type: 'json', description: 'User metadata' },
  },
  outputs: {
    threadId: { type: 'string', description: 'Thread identifier' },
    userId: { type: 'string', description: 'User identifier' },
    uuid: { type: 'string', description: 'Internal UUID' },
    createdAt: { type: 'string', description: 'Creation timestamp' },
    updatedAt: { type: 'string', description: 'Update timestamp' },
    threads: { type: 'json', description: 'Array of threads' },
    deleted: { type: 'boolean', description: 'Deletion status' },
    messages: { type: 'json', description: 'Message data' },
    messageIds: { type: 'json', description: 'Message identifiers' },
    context: { type: 'string', description: 'User context string' },
    facts: { type: 'json', description: 'Extracted facts' },
    entities: { type: 'json', description: 'Extracted entities' },
    summary: { type: 'string', description: 'Conversation summary' },
    batchId: { type: 'string', description: 'Batch operation ID' },
    email: { type: 'string', description: 'User email' },
    firstName: { type: 'string', description: 'User first name' },
    lastName: { type: 'string', description: 'User last name' },
    metadata: { type: 'json', description: 'User metadata' },
    responseCount: { type: 'number', description: 'Number of items in response' },
    totalCount: { type: 'number', description: 'Total number of items available' },
    rowCount: { type: 'number', description: 'Number of rows in response' },
  },
}

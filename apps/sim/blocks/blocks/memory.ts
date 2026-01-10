import { BrainIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

export const MemoryBlock: BlockConfig = {
  type: 'memory',
  name: 'Memory',
  description: 'Add memory store',
  longDescription:
    'Integrate Memory into the workflow. Can add, get a memory, get all memories, and delete memories.',
  bgColor: '#F64F9E',
  bestPractices: `
  - Do not use this block unless the user explicitly asks for it.
  - Used in conjunction with agent blocks to inject artificial memory into the conversation. For natural conversations, use the agent block memories modes directly instead.
  `,
  icon: BrainIcon,
  category: 'blocks',
  docsLink: 'https://docs.sim.ai/tools/memory',
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Add Memory', id: 'add' },
        { label: 'Get All Memories', id: 'getAll' },
        { label: 'Get Memory', id: 'get' },
        { label: 'Delete Memory', id: 'delete' },
      ],
      placeholder: 'Select operation',
      value: () => 'add',
    },
    {
      id: 'id',
      title: 'Conversation ID',
      type: 'short-input',
      placeholder: 'Enter conversation ID (e.g., user-123)',
      condition: {
        field: 'operation',
        value: 'add',
      },
      required: true,
    },
    {
      id: 'id',
      title: 'Conversation ID',
      type: 'short-input',
      placeholder: 'Enter conversation ID (e.g., user-123)',
      condition: {
        field: 'operation',
        value: 'get',
      },
      required: true,
    },
    {
      id: 'id',
      title: 'Conversation ID',
      type: 'short-input',
      placeholder: 'Enter conversation ID (e.g., user-123)',
      condition: {
        field: 'operation',
        value: 'delete',
      },
      required: true,
    },
    {
      id: 'role',
      title: 'Role',
      type: 'dropdown',
      options: [
        { label: 'User', id: 'user' },
        { label: 'Assistant', id: 'assistant' },
        { label: 'System', id: 'system' },
      ],
      placeholder: 'Select agent role',
      condition: {
        field: 'operation',
        value: 'add',
      },
      required: true,
    },
    {
      id: 'content',
      title: 'Content',
      type: 'short-input',
      placeholder: 'Enter message content',
      condition: {
        field: 'operation',
        value: 'add',
      },
      required: true,
    },
  ],
  tools: {
    access: ['memory_add', 'memory_get', 'memory_get_all', 'memory_delete'],
    config: {
      tool: (params: Record<string, any>) => {
        const operation = params.operation || 'add'
        switch (operation) {
          case 'add':
            return 'memory_add'
          case 'get':
            return 'memory_get'
          case 'getAll':
            return 'memory_get_all'
          case 'delete':
            return 'memory_delete'
          default:
            return 'memory_add'
        }
      },
      params: (params: Record<string, any>) => {
        const errors: string[] = []

        if (!params.operation) {
          errors.push('Operation is required')
        }

        const conversationId = params.id || params.conversationId

        if (params.operation === 'add') {
          if (!conversationId) {
            errors.push('Conversation ID is required for add operation')
          }
        }

        if (params.operation === 'get' || params.operation === 'delete') {
          if (!conversationId) {
            errors.push(`Conversation ID is required for ${params.operation} operation`)
          }
        }

        if (errors.length > 0) {
          throw new Error(`Memory Block Error: ${errors.join(', ')}`)
        }

        const baseResult: Record<string, any> = {}

        if (params.operation === 'add') {
          return {
            ...baseResult,
            conversationId: conversationId,
            role: params.role,
            content: params.content,
          }
        }

        if (params.operation === 'get') {
          return {
            ...baseResult,
            conversationId: conversationId,
          }
        }

        if (params.operation === 'delete') {
          return {
            ...baseResult,
            conversationId: conversationId,
          }
        }

        return baseResult
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    id: { type: 'string', description: 'Memory identifier (conversation ID)' },
    conversationId: { type: 'string', description: 'Conversation identifier' },
    role: { type: 'string', description: 'Agent role' },
    content: { type: 'string', description: 'Memory content' },
  },
  outputs: {
    memories: { type: 'json', description: 'Memory data' },
    id: { type: 'string', description: 'Memory identifier' },
  },
}

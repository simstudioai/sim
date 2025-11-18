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
  - Search up examples with memory blocks to understand YAML syntax. 
  - Used in conjunction with agent blocks to persist messages between runs. User messages should be added with role 'user' and assistant messages should be added with role 'assistant' with the agent sandwiched between.
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
      id: 'conversationId',
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
      id: 'blockId',
      title: 'Block ID',
      type: 'short-input',
      placeholder: 'Enter block ID (optional, defaults to current block)',
      condition: {
        field: 'operation',
        value: 'add',
      },
      required: false,
    },
    {
      id: 'conversationId',
      title: 'Conversation ID',
      type: 'short-input',
      placeholder: 'Enter conversation ID (e.g., user-123)',
      condition: {
        field: 'operation',
        value: 'get',
      },
      required: false,
    },
    {
      id: 'blockId',
      title: 'Block ID',
      type: 'short-input',
      placeholder: 'Enter block ID (optional)',
      condition: {
        field: 'operation',
        value: 'get',
      },
      required: false,
    },
    {
      id: 'blockName',
      title: 'Block Name',
      type: 'short-input',
      placeholder: 'Enter block name (optional)',
      condition: {
        field: 'operation',
        value: 'get',
      },
      required: false,
    },
    {
      id: 'conversationId',
      title: 'Conversation ID',
      type: 'short-input',
      placeholder: 'Enter conversation ID (e.g., user-123)',
      condition: {
        field: 'operation',
        value: 'delete',
      },
      required: false,
    },
    {
      id: 'blockId',
      title: 'Block ID',
      type: 'short-input',
      placeholder: 'Enter block ID (optional)',
      condition: {
        field: 'operation',
        value: 'delete',
      },
      required: false,
    },
    {
      id: 'blockName',
      title: 'Block Name',
      type: 'short-input',
      placeholder: 'Enter block name (optional)',
      condition: {
        field: 'operation',
        value: 'delete',
      },
      required: false,
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

        if (params.operation === 'add') {
          if (!params.conversationId) {
            errors.push('Conversation ID is required for add operation')
          }
          if (!params.role) {
            errors.push('Role is required for agent memory')
          }
          if (!params.content) {
            errors.push('Content is required for agent memory')
          }
        }

        if (params.operation === 'get' || params.operation === 'delete') {
          if (!params.conversationId && !params.blockId && !params.blockName) {
            errors.push(
              `At least one of conversationId, blockId, or blockName is required for ${params.operation} operation`
            )
          }
        }

        if (errors.length > 0) {
          throw new Error(`Memory Block Error: ${errors.join(', ')}`)
        }

        const baseResult: Record<string, any> = {}

        if (params.operation === 'add') {
          const result: Record<string, any> = {
            ...baseResult,
            conversationId: params.conversationId,
            role: params.role,
            content: params.content,
          }
          if (params.blockId) {
            result.blockId = params.blockId
          }

          return result
        }

        if (params.operation === 'get') {
          const result: Record<string, any> = { ...baseResult }
          if (params.conversationId) result.conversationId = params.conversationId
          if (params.blockId) result.blockId = params.blockId
          if (params.blockName) result.blockName = params.blockName
          return result
        }

        if (params.operation === 'delete') {
          const result: Record<string, any> = { ...baseResult }
          if (params.conversationId) result.conversationId = params.conversationId
          if (params.blockId) result.blockId = params.blockId
          if (params.blockName) result.blockName = params.blockName
          return result
        }

        return baseResult
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    id: { type: 'string', description: 'Memory identifier (for add operation)' },
    conversationId: { type: 'string', description: 'Conversation identifier' },
    blockId: { type: 'string', description: 'Block identifier' },
    blockName: { type: 'string', description: 'Block name' },
    role: { type: 'string', description: 'Agent role' },
    content: { type: 'string', description: 'Memory content' },
  },
  outputs: {
    memories: { type: 'json', description: 'Memory data' },
    id: { type: 'string', description: 'Memory identifier' },
  },
}

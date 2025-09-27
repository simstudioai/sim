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
      layout: 'full',
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
      title: 'ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter memory identifier',
      condition: {
        field: 'operation',
        value: 'add',
      },
      required: true,
    },
    {
      id: 'id',
      title: 'ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter memory identifier to retrieve',
      condition: {
        field: 'operation',
        value: 'get',
      },
      required: true,
    },
    {
      id: 'id',
      title: 'ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter memory identifier to delete',
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
      layout: 'full',
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
      layout: 'full',
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
        // Create detailed error information for any missing required fields
        const errors: string[] = []

        if (!params.operation) {
          errors.push('Operation is required')
        }

        if (
          params.operation === 'add' ||
          params.operation === 'get' ||
          params.operation === 'delete'
        ) {
          if (!params.id) {
            errors.push(`Memory ID is required for ${params.operation} operation`)
          }
        }

        if (params.operation === 'add') {
          if (!params.role) {
            errors.push('Role is required for agent memory')
          }
          if (!params.content) {
            errors.push('Content is required for agent memory')
          }
        }

        // Throw error if any required fields are missing
        if (errors.length > 0) {
          throw new Error(`Memory Block Error: ${errors.join(', ')}`)
        }

        // Base result object
        const baseResult: Record<string, any> = {}

        // For add operation
        if (params.operation === 'add') {
          const result: Record<string, any> = {
            ...baseResult,
            id: params.id,
            type: 'agent', // Always agent type
            role: params.role,
            content: params.content,
          }

          return result
        }

        // For get operation
        if (params.operation === 'get') {
          return {
            ...baseResult,
            id: params.id,
          }
        }

        // For delete operation
        if (params.operation === 'delete') {
          return {
            ...baseResult,
            id: params.id,
          }
        }

        // For getAll operation
        return baseResult
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    id: { type: 'string', description: 'Memory identifier' },
    role: { type: 'string', description: 'Agent role' },
    content: { type: 'string', description: 'Memory content' },
  },
  outputs: {
    memories: { type: 'json', description: 'Memory data' },
    id: { type: 'string', description: 'Memory identifier' },
  },
}

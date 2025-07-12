import { SupabaseIcon } from '@/components/icons'
import type { ToolResponse } from '@/tools/types'
import type { BlockConfig } from '../types'

interface SupabaseResponse extends ToolResponse {
  output: {
    message: string
    results: any
  }
  error?: string
}

export const SupabaseBlock: BlockConfig<SupabaseResponse> = {
  type: 'supabase',
  name: 'Supabase',
  description: 'Use Supabase database',
  longDescription:
    'Integrate with Supabase to manage your database, authentication, storage, and more. Query data, manage users, and interact with Supabase services directly.',
  docsLink: 'https://docs.simstudio.ai/tools/supabase',
  category: 'tools',
  bgColor: '#1C1C1C',
  icon: SupabaseIcon,
  subBlocks: [
    // Operation selector
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Read All Rows', id: 'query' },
        { label: 'Insert Rows', id: 'insert' },
      ],
    },
    // Common Fields
    {
      id: 'projectId',
      title: 'Project ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Your Supabase project ID (e.g., jdrkgepadsdopsntdlom)',
    },
    {
      id: 'table',
      title: 'Table',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Name of the table',
    },
    {
      id: 'apiKey',
      title: 'Client Anon Key',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Your Supabase client anon key',
      password: true,
    },
    // Insert-specific Fields
    {
      id: 'data',
      title: 'Data',
      type: 'code',
      layout: 'full',
      placeholder: '{\n  "column1": "value1",\n  "column2": "value2"\n}',
      condition: { field: 'operation', value: 'insert' },
    },
  ],
  tools: {
    access: ['supabase_query', 'supabase_insert'],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'query':
            return 'supabase_query'
          case 'insert':
            return 'supabase_insert'
          default:
            throw new Error(`Invalid Supabase operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const { data, ...rest } = params

        // Parse JSON data if it's a string
        let parsedData
        if (data && typeof data === 'string') {
          try {
            parsedData = JSON.parse(data)
          } catch (_e) {
            throw new Error('Invalid JSON data format')
          }
        } else {
          parsedData = data
        }

        return {
          ...rest,
          data: parsedData,
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', required: true },
    projectId: { type: 'string', required: true },
    table: { type: 'string', required: true },
    apiKey: { type: 'string', required: true },
    // Insert operation inputs
    data: { type: 'string', required: false },
  },
  outputs: {
    message: 'string',
    results: 'json',
  },
}

import { SupabaseIcon } from '@/components/icons'
import { ToolResponse } from '@/tools/types'
import { BlockConfig } from '../types'

interface SupabaseResponse extends ToolResponse {
  data: any
  error: any
}

export const SupabaseBlock: BlockConfig<SupabaseResponse> = {
  type: 'supabase',
  name: 'Supabase',
  description: 'Use Supabase database',
  longDescription:
    'Integrate with Supabase to manage your database, authentication, storage, and more. Query data, manage users, and interact with Supabase services using OAuth authentication.',
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
        { label: 'Query Data', id: 'query' },
        { label: 'Insert Data', id: 'insert' },
        { label: 'Update Data', id: 'update' },
      ],
    },
    // Supabase Credentials
    {
      id: 'credential',
      title: 'Supabase Account',
      type: 'oauth-input',
      layout: 'full',
      provider: 'supabase',
      serviceId: 'supabase',
      requiredScopes: ['database.read', 'database.write', 'projects.read'],
      placeholder: 'Select Supabase account',
    },
    // Common Fields
    {
      id: 'projectId',
      title: 'Project ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'ID of the Supabase project',
    },
    {
      id: 'table',
      title: 'Table',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Name of the table',
    },
    // Query-specific Fields
    {
      id: 'select',
      title: 'Select',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Columns to select (e.g., id, name, email)',
      condition: { field: 'operation', value: 'query' },
    },
    {
      id: 'filter',
      title: 'Filter',
      type: 'long-input',
      layout: 'full',
      placeholder:
        'Filter conditions as JSON (e.g., {"column": "name", "operator": "eq", "value": "John"})',
      condition: { field: 'operation', value: 'query' },
    },
    // Insert/Update-specific Fields
    {
      id: 'data',
      title: 'Data',
      type: 'long-input',
      layout: 'full',
      placeholder:
        'Data to insert/update as JSON (e.g., {"name": "John", "email": "john@example.com"})',
      condition: { field: 'operation', value: 'insert' },
    },
    {
      id: 'data',
      title: 'Data',
      type: 'long-input',
      layout: 'full',
      placeholder:
        'Data to insert/update as JSON (e.g., {"name": "John", "email": "john@example.com"})',
      condition: { field: 'operation', value: 'update' },
    },
    // Update-specific Fields
    {
      id: 'filter',
      title: 'Filter',
      type: 'long-input',
      layout: 'full',
      placeholder:
        'Filter conditions as JSON (e.g., {"column": "id", "operator": "eq", "value": 123})',
      condition: { field: 'operation', value: 'update' },
    },
  ],
  tools: {
    access: ['supabase_query', 'supabase_insert', 'supabase_update'],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'query':
            return 'supabase_query'
          case 'insert':
            return 'supabase_insert'
          case 'update':
            return 'supabase_update'
          default:
            throw new Error(`Invalid Supabase operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const { credential, data, filter, ...rest } = params

        // Parse JSON strings to objects if they exist
        const parsedData = data ? JSON.parse(data as string) : undefined
        const parsedFilter = filter ? JSON.parse(filter as string) : undefined

        return {
          ...rest,
          data: parsedData,
          filter: parsedFilter,
          credential,
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', required: true },
    credential: { type: 'string', required: true },
    projectId: { type: 'string', required: true },
    table: { type: 'string', required: true },
    // Query operation inputs
    select: { type: 'string', required: false },
    filter: { type: 'string', required: false },
    // Insert/Update operation inputs
    data: { type: 'string', required: false },
  },
  outputs: {
    response: {
      type: {
        success: 'boolean',
        output: 'json',
        severity: 'string',
        data: 'json',
        error: 'json',
      },
    },
  },
}

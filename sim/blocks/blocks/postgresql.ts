import { PostgreSQLIcon } from '@/components/icons'
import { PostgreSQLResponse } from '@/tools/database/postgresql/types'
import { BlockConfig } from '../types'

export const PostgreSQLBlock: BlockConfig<PostgreSQLResponse> = {
  type: 'postgresql',
  name: 'PostgreSQL',
  description: 'Execute PostgreSQL operations',
  longDescription:
    'Connect to and interact with PostgreSQL databases. Perform select, insert, update, delete, and other SQL operations.',
  category: 'tools',
  bgColor: '#336791',
  icon: PostgreSQLIcon,
  subBlocks: [
    {
      id: 'host',
      title: 'Host',
      type: 'short-input',
      layout: 'half',
      placeholder: 'localhost or database host',
      value: () => 'localhost',
    },
    {
      id: 'port',
      title: 'Port',
      type: 'short-input',
      layout: 'half',
      placeholder: '5432',
      value: () => '5432',
    },
    {
      id: 'username',
      title: 'Username',
      type: 'short-input',
      layout: 'half',
      placeholder: 'Enter username (default: postgres)',
      value: () => 'postgres',
    },
    {
      id: 'password',
      title: 'Password',
      type: 'short-input',
      layout: 'half',
      placeholder: 'Enter password',
      password: true,
      value: () => '',
    },
    {
      id: 'database',
      title: 'Database',
      type: 'short-input',
      layout: 'half',
      placeholder: 'Enter database name',
      value: () => 'postgres',
    },
    {
      id: 'ssl',
      title: 'Use SSL',
      type: 'dropdown',
      layout: 'half',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
    },
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      layout: 'half',
      options: [
        { label: 'Select', id: 'select' },
        { label: 'Insert', id: 'insert' },
        { label: 'Update', id: 'update' },
        { label: 'Delete', id: 'delete' },
        { label: 'Execute', id: 'execute' },
      ],
      value: () => 'select',
    },
    {
      id: 'query',
      title: 'Query',
      type: 'code',
      layout: 'full',
      placeholder: 'Enter SQL query',
      buttons: [
        {
          id: 'generate',
          label: 'Generate SQL',
          onClick: async (params) => {
            try {
              const response = await fetch('/api/codegen', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  generationType: 'sql-query',
                  prompt: 'Generate SQL query',
                  history: [],
                }),
              })
              
              if (!response.ok) {
                throw new Error('Failed to generate SQL query')
              }
              
              const data = await response.json()
              return data.generatedContent
            } catch (error) {
              console.error('Error generating SQL query:', error)
              throw error
            }
          },
        },
      ],
    },
    {
      id: 'params',
      title: 'Parameters',
      type: 'code',
      layout: 'full',
      placeholder: 'Enter query parameters as array (e.g., ["value1", "value2"])',
    },
    {
      id: 'options',
      title: 'Options',
      type: 'code',
      layout: 'full',
      placeholder: 'Enter additional query options as JSON (optional)',
    },
  ],
  tools: {
    access: ['postgresql'],
    config: {
      tool: () => 'postgresql',
      params: (params) => {
        const connection = {
          host: params.host || 'localhost',
          port: parseInt(params.port || '5432'),
          username: params.username || 'postgres',
          password: params.password || '',
          database: params.database || 'postgres',
          ssl: params.ssl === 'true'
        }
        return {
          connection,
          operation: params.operation,
          query: params.query,
          params: params.params ? JSON.parse(params.params) : undefined,
          options: params.options ? JSON.parse(params.options) : undefined,
        }
      },
    },
  },
  inputs: {
    host: { type: 'string', required: false },
    port: { type: 'string', required: false },
    username: { type: 'string', required: false },
    password: { type: 'string', required: false },
    database: { type: 'string', required: false },
    ssl: { type: 'string', required: false },
    operation: { type: 'string', required: true },
    query: { type: 'string', required: true },
    params: { type: 'json', required: false },
    options: { type: 'json', required: false },
  },
  outputs: {
    response: {
      type: {
        rows: 'json',
        rowCount: 'number',
        fields: 'any'
      }
    }
  },
} 
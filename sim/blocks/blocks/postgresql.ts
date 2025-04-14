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
        // Ensure params is defined
        const p = params || {}
        
        // Validate required fields
        if (!p.host) throw new Error('PostgreSQL host is required')
        if (!p.database) throw new Error('PostgreSQL database is required')
        if (!p.username) throw new Error('PostgreSQL username is required')
        if (!p.password) throw new Error('PostgreSQL password is required')
        if (!p.operation) throw new Error('PostgreSQL operation is required')
        if (!p.query) throw new Error('PostgreSQL query is required')
        
        // Safe parsing of port number
        const port = parseInt(p.port || '5432', 10)
        if (isNaN(port)) throw new Error('Invalid PostgreSQL port number')
        
        const connection = {
          host: p.host,
          port: port,
          user: p.username,
          password: p.password,
          database: p.database,
          ssl: p.ssl === 'true',
          schema: p.schema
        }

        try {
          return {
            connection,
            operation: p.operation,
            query: p.query,
            params: p.params ? JSON.parse(p.params) : undefined,
            options: p.options ? JSON.parse(p.options) : undefined
          }
        } catch (error) {
          throw new Error('Invalid JSON in params or options')
        }
      },
    },
  },
  inputs: {
    host: { type: 'string', required: true },
    port: { type: 'string', required: true },
    username: { type: 'string', required: true },
    password: { type: 'string', required: true },
    database: { type: 'string', required: true },
    ssl: { type: 'string', required: true },
    schema: { type: 'string', required: false },
    operation: { type: 'string', required: true },
    query: { type: 'string', required: true },
    params: { type: 'json', required: false },
    options: { type: 'json', required: false }
  },
  outputs: {
    response: {
      type: {
        rows: 'json',
        rowCount: 'number',
        fields: 'json',
        executionTime: 'any'
      }
    }
  },
} 
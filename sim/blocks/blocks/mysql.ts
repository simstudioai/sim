import { MySQLIcon } from '@/components/icons'
import { MySQLResponse } from '@/tools/database/mysql/types'
import { BlockConfig } from '../types'

export const MySQLBlock: BlockConfig<MySQLResponse> = {
  type: 'mysql',
  name: 'MySQL',
  description: 'Execute MySQL operations',
  longDescription:
    'Connect to and interact with MySQL databases. Perform select, insert, update, delete, and other SQL operations.',
  category: 'tools',
  bgColor: '#00758F',
  icon: MySQLIcon,
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
      placeholder: '3306',
      value: () => '3306',
    },
    {
      id: 'user',
      title: 'Username',
      type: 'short-input',
      layout: 'half',
      placeholder: 'Enter username',
      value: () => 'root',
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
      value: () => '',
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
      placeholder: 'Enter query parameters as array',
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
    access: ['mysql'],
    config: {
      tool: () => 'mysql',
      params: (params) => {
        // Ensure params is defined
        const p = params || {}
        
        // Validate required fields
        if (!p.host) throw new Error('MySQL host is required')
        if (!p.database) throw new Error('MySQL database is required')
        if (!p.user) throw new Error('MySQL username is required')
        if (!p.operation) throw new Error('MySQL operation is required')
        if (!p.query) throw new Error('MySQL query is required')
        
        return {
          connection: {
            host: p.host,
            port: parseInt(p.port || '3306'),
            user: p.user,
            password: p.password || '',
            database: p.database,
            ssl: p.ssl === 'true'
          },
          operation: p.operation,
          query: p.query,
          params: p.params ? JSON.parse(p.params) : undefined,
          options: p.options ? JSON.parse(p.options) : undefined
        }
      },
    },
  },
  inputs: {
    host: { type: 'string', required: true },
    port: { type: 'string', required: true },
    user: { type: 'string', required: true },
    password: { type: 'string', required: true },
    database: { type: 'string', required: true },
    ssl: { type: 'string', required: true },
    operation: { type: 'string', required: true },
    query: { type: 'string', required: true },
    params: { type: 'json', required: false },
    options: { type: 'json', required: false }
  },
  outputs: {
    response: {
      type: {
        rows: 'json',
        affectedRows: 'number',
        metadata: 'json'
      }
    }
  },
} 
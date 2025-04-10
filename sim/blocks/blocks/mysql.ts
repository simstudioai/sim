import { MySQLIcon } from '@/components/icons'
import { MySQLResponse } from '@/tools/databases/mysql/types'
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
    },
    {
      id: 'params',
      title: 'Parameters',
      type: 'code',
      layout: 'full',
      placeholder: 'Enter query parameters as array',
    },
  ],
  tools: {
    access: ['mysql'],
    config: {
      tool: () => 'mysql',
      params: (params) => ({
        connection: {
          host: params.host || 'localhost',
          port: parseInt(params.port || '3306'),
          user: params.user || 'root',
          password: params.password || '',
          database: params.database,
          ssl: params.ssl === 'true'
        },
        operation: params.operation,
        query: params.query,
        params: params.params ? JSON.parse(params.params) : undefined
      }),
    },
  },
  inputs: {
    host: { type: 'string', required: false },
    port: { type: 'string', required: false },
    user: { type: 'string', required: false },
    password: { type: 'string', required: false },
    database: { type: 'string', required: true },
    ssl: { type: 'string', required: false },
    operation: { type: 'string', required: true },
    query: { type: 'string', required: true },
    params: { type: 'json', required: false }
  },
  outputs: {
    response: {
      type: {
        rows: 'string',
        affectedRows: 'string',
        metadata: 'string'
      }
    }
  },
} 
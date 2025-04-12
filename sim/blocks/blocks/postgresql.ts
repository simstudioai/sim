import { PostgreSQLIcon } from '@/components/icons'
import { PostgreSQLResponse } from '@/tools/databases/postgresql/types'
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
      required: true,
      validate: (value) => {
        if (!value) return 'Host is required'
        return null
      }
    },
    {
      id: 'port',
      title: 'Port',
      type: 'short-input',
      layout: 'half',
      placeholder: '5432',
      value: () => '5432',
      required: true,
      validate: (value) => {
        if (!value) return 'Port is required'
        const portNum = parseInt(value)
        if (isNaN(portNum) || portNum < 1 || portNum > 65535) return 'Port must be a number between 1 and 65535'
        return null
      }
    },
    {
      id: 'username',
      title: 'Username',
      type: 'short-input',
      layout: 'half',
      placeholder: 'Enter username (default: postgres)',
      value: () => 'postgres',
      required: true,
      validate: (value) => {
        if (!value) return 'Username is required'
        return null
      }
    },
    {
      id: 'password',
      title: 'Password',
      type: 'short-input',
      layout: 'half',
      placeholder: 'Enter password',
      password: true,
      value: () => '',
      required: true,
      validate: (value) => {
        if (!value) return 'Password is required'
        return null
      }
    },
    {
      id: 'database',
      title: 'Database',
      type: 'short-input',
      layout: 'half',
      placeholder: 'Enter database name',
      value: () => '',
      required: true,
      validate: (value) => {
        if (!value) return 'Database name is required'
        return null
      }
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
      id: 'sslCA',
      title: 'CA Certificate',
      type: 'short-input',
      layout: 'half',
      placeholder: 'Enter CA certificate',
      value: () => '',
      required: false,
    },
    {
      id: 'sslKey',
      title: 'Client Key',
      type: 'short-input',
      layout: 'half',
      placeholder: 'Enter client key',
      value: () => '',
      required: false,
    },
    {
      id: 'sslCert',
      title: 'Client Certificate',
      type: 'short-input',
      layout: 'half',
      placeholder: 'Enter client certificate',
      value: () => '',
      required: false,
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
      placeholder: 'Enter SQL query (e.g., SELECT * FROM users)',
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
      placeholder: 'Enter query options as JSON (e.g., {"page": 1, "pageSize": 50})',
      value: () => JSON.stringify({
        page: 1,
        pageSize: 100
      }, null, 2),
      condition: { field: 'operation', value: 'select' }
    },
  ],
  tools: {
    access: ['postgresql'],
    config: {
      tool: () => 'postgresql',
      params: (params) => {
        // Validate required parameters
        if (!params.password) {
          throw new Error('Password is required for PostgreSQL connection');
        }

        const connection = {
          host: params.host || 'localhost',
          port: parseInt(params.port || '5432'),
          username: params.username || 'postgres',
          password: params.password, // No default value, password is required
          database: params.database || 'postgres',
          ssl: params.ssl === 'true' ? {
            rejectUnauthorized: true,
            ca: params.sslCA || undefined,
            key: params.sslKey || undefined,
            cert: params.sslCert || undefined,
          } : false
        }

        // Parse options with defaults for SELECT queries
        let options = params.options ? JSON.parse(params.options) : {}
        if (params.operation === 'select') {
          options = {
            page: 1,
            pageSize: 100,
            ...options
          }
        }

        return {
          connection,
          operation: params.operation,
          query: params.query,
          params: params.params ? JSON.parse(params.params) : undefined,
          options
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
    sslCA: { type: 'string', required: false },
    sslKey: { type: 'string', required: false },
    sslCert: { type: 'string', required: false },
    operation: { type: 'string', required: true },
    query: { type: 'string', required: true },
    params: { type: 'json', required: false },
    options: { type: 'json', required: false },
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
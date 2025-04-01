import { PostgreSQLIcon } from '@/components/icons'
import { PostgreSQLResponse } from '@/tools/postgresql/types'
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
      id: 'connection',
      title: 'Connection',
      type: 'tool-input',
      layout: 'full',
      placeholder: 'Configure PostgreSQL connection',
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
    {
      id: 'options',
      title: 'Options',
      type: 'code',
      layout: 'full',
      placeholder: 'Enter query options',
    },
  ],
  tools: {
    access: ['postgresql'],
    config: {
      tool: () => 'postgresql',
      params: (params) => ({
        connection: params.connection,
        operation: params.operation,
        query: params.query,
        params: params.params ? JSON.parse(params.params) : undefined,
        options: params.options ? JSON.parse(params.options) : undefined,
      }),
    },
  },
  inputs: {
    connection: { type: 'json', required: true },
    operation: { type: 'string', required: true },
    query: { type: 'string', required: true },
    params: { type: 'json', required: false },
    options: { type: 'json', required: false },
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
import { MySQLIcon } from '@/components/icons'
import { MySQLResponse } from '@/tools/mysql/types'
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
      id: 'connection',
      title: 'Connection',
      type: 'tool-input',
      layout: 'full',
      placeholder: 'Configure MySQL connection',
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
    access: ['mysql'],
    config: {
      tool: () => 'mysql',
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
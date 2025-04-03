import { RedisIcon } from '@/components/icons'
import { RedisResponse } from '@/tools/databases/redis/types'
import { BlockConfig } from '../types'

export const RedisBlock: BlockConfig<RedisResponse> = {
  type: 'redis',
  name: 'Redis',
  description: 'Execute Redis operations',
  longDescription:
    'Connect to and interact with Redis databases. Perform get, set, delete, and other Redis operations on your data.',
  category: 'tools',
  bgColor: '#D82C20',
  icon: RedisIcon,
  subBlocks: [
    {
      id: 'host',
      title: 'Host',
      type: 'short-input',
      layout: 'half',
      placeholder: 'Redis server hostname (default: redis)',
      value: () => 'redis',
    },
    {
      id: 'port',
      title: 'Port',
      type: 'short-input',
      layout: 'half',
      placeholder: 'Redis server port (default: 6379)',
      value: () => '6379',
    },
    {
      id: 'password',
      title: 'Password',
      type: 'short-input',
      layout: 'half',
      placeholder: 'Redis server password (default: redis)',
      password: true,
      value: () => 'redis',
    },
    {
      id: 'db',
      title: 'Database',
      type: 'short-input',
      layout: 'half',
      placeholder: 'Redis database number (default: 0)',
      value: () => '0',
    },
    {
      id: 'tls',
      title: 'Use TLS',
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
        { label: 'Get', id: 'get' },
        { label: 'Set', id: 'set' },
        { label: 'Delete', id: 'delete' },
        { label: 'Keys', id: 'keys' },
      ],
      value: () => 'get',
    },
    {
      id: 'key',
      title: 'Key',
      type: 'short-input',
      layout: 'half',
      placeholder: 'Enter Redis key to operate on',
    },
    {
      id: 'value',
      title: 'Value',
      type: 'code',
      layout: 'full',
      placeholder: 'Enter value to set (for SET operation)',
      condition: {
        field: 'operation',
        value: ['set'],
      },
    },
    {
      id: 'ttl',
      title: 'TTL (seconds)',
      type: 'short-input',
      layout: 'half',
      placeholder: 'Enter time to live in seconds (for SET operation)',
      condition: {
        field: 'operation',
        value: ['set'],
      },
    },
    {
      id: 'options',
      title: 'Options',
      type: 'code',
      layout: 'full',
      placeholder: 'Enter additional operation options in JSON format',
    },
  ],
  tools: {
    access: ['redis'],
    config: {
      tool: () => 'redis',
      params: (params) => {
        const connection = {
          host: params.host || 'redis',
          port: parseInt(params.port || '6379'),
          password: params.password || 'redis',
          db: parseInt(params.db || '0'),
          tls: params.tls === 'true'
        }
        return {
          connection,
          operation: params.operation,
          key: params.key,
          value: params.value,
          ttl: params.ttl ? parseInt(params.ttl) : undefined,
          options: params.options ? JSON.parse(params.options) : undefined
        }
      },
    },
  },
  inputs: {
    host: { type: 'string', required: false },
    port: { type: 'string', required: false },
    password: { type: 'string', required: false },
    db: { type: 'string', required: false },
    tls: { type: 'string', required: false },
    operation: { type: 'string', required: true },
    key: { type: 'string', required: true },
    value: { type: 'string', required: false },
    ttl: { type: 'number', required: false },
    options: { type: 'json', required: false },
  },
  outputs: {
    response: {
      type: {
        result: 'string',
        metadata: 'string'
      }
    }
  },
} 
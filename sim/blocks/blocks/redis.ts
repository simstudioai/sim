import { RedisIcon } from '@/components/icons'
import { RedisResponse } from '@/tools/redis/types'
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
      id: 'connection',
      title: 'Connection',
      type: 'tool-input',
      layout: 'full',
      placeholder: 'Configure Redis connection',
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
        { label: 'Hash Get', id: 'hget' },
        { label: 'Hash Set', id: 'hset' },
        { label: 'List Push', id: 'lpush' },
        { label: 'List Range', id: 'lrange' },
        { label: 'Set Add', id: 'sadd' },
        { label: 'Set Members', id: 'smembers' },
        { label: 'Publish', id: 'publish' },
        { label: 'Subscribe', id: 'subscribe' },
      ],
      value: () => 'get',
    },
    {
      id: 'key',
      title: 'Key',
      type: 'short-input',
      layout: 'half',
      placeholder: 'Enter Redis key',
      condition: {
        field: 'operation',
        value: ['get', 'set', 'delete', 'hget', 'hset', 'lpush', 'lrange', 'sadd', 'smembers'],
      },
    },
    {
      id: 'pattern',
      title: 'Pattern',
      type: 'short-input',
      layout: 'half',
      placeholder: 'Enter key pattern',
      condition: {
        field: 'operation',
        value: ['keys'],
      },
    },
    {
      id: 'value',
      title: 'Value',
      type: 'code',
      layout: 'full',
      placeholder: 'Enter value to set',
      condition: {
        field: 'operation',
        value: ['set', 'hset', 'lpush', 'sadd'],
      },
    },
    {
      id: 'ttl',
      title: 'TTL (seconds)',
      type: 'short-input',
      layout: 'half',
      placeholder: 'Enter TTL in seconds',
      condition: {
        field: 'operation',
        value: ['set'],
      },
    },
    {
      id: 'channel',
      title: 'Channel',
      type: 'short-input',
      layout: 'half',
      placeholder: 'Enter channel name',
      condition: {
        field: 'operation',
        value: ['publish', 'subscribe'],
      },
    },
    {
      id: 'message',
      title: 'Message',
      type: 'code',
      layout: 'full',
      placeholder: 'Enter message to publish',
      condition: {
        field: 'operation',
        value: ['publish'],
      },
    },
    {
      id: 'options',
      title: 'Options',
      type: 'code',
      layout: 'full',
      placeholder: 'Enter operation options',
    },
  ],
  tools: {
    access: ['redis'],
    config: {
      tool: () => 'redis',
      params: (params) => ({
        connection: params.connection,
        operation: params.operation,
        key: params.key,
        pattern: params.pattern,
        value: params.value ? JSON.parse(params.value) : undefined,
        ttl: params.ttl ? parseInt(params.ttl) : undefined,
        channel: params.channel,
        message: params.message ? JSON.parse(params.message) : undefined,
        options: params.options ? JSON.parse(params.options) : undefined,
      }),
    },
  },
  inputs: {
    connection: { type: 'json', required: true },
    operation: { type: 'string', required: true },
    key: { type: 'string', required: false },
    pattern: { type: 'string', required: false },
    value: { type: 'json', required: false },
    ttl: { type: 'number', required: false },
    channel: { type: 'string', required: false },
    message: { type: 'json', required: false },
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
import { UpstashIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type {
  UpstashRedisCommandResponse,
  UpstashRedisDeleteResponse,
  UpstashRedisExistsResponse,
  UpstashRedisExpireResponse,
  UpstashRedisGetResponse,
  UpstashRedisHGetAllResponse,
  UpstashRedisHGetResponse,
  UpstashRedisHSetResponse,
  UpstashRedisIncrbyResponse,
  UpstashRedisIncrResponse,
  UpstashRedisKeysResponse,
  UpstashRedisLPushResponse,
  UpstashRedisLRangeResponse,
  UpstashRedisSetnxResponse,
  UpstashRedisSetResponse,
  UpstashRedisTtlResponse,
} from '@/tools/upstash/types'

type UpstashResponse =
  | UpstashRedisGetResponse
  | UpstashRedisSetResponse
  | UpstashRedisDeleteResponse
  | UpstashRedisKeysResponse
  | UpstashRedisCommandResponse
  | UpstashRedisHSetResponse
  | UpstashRedisHGetResponse
  | UpstashRedisHGetAllResponse
  | UpstashRedisIncrResponse
  | UpstashRedisIncrbyResponse
  | UpstashRedisExpireResponse
  | UpstashRedisTtlResponse
  | UpstashRedisLPushResponse
  | UpstashRedisLRangeResponse
  | UpstashRedisExistsResponse
  | UpstashRedisSetnxResponse

export const UpstashBlock: BlockConfig<UpstashResponse> = {
  type: 'upstash',
  name: 'Upstash',
  description: 'Serverless Redis with Upstash',
  longDescription:
    'Connect to Upstash Redis to perform key-value, hash, list, and utility operations via the REST API.',
  docsLink: 'https://docs.sim.ai/tools/upstash',
  category: 'tools',
  bgColor: '#181C1E',
  authMode: AuthMode.ApiKey,
  icon: UpstashIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Get', id: 'get' },
        { label: 'Set', id: 'set' },
        { label: 'Delete', id: 'delete' },
        { label: 'List Keys', id: 'keys' },
        { label: 'HSET', id: 'hset' },
        { label: 'HGET', id: 'hget' },
        { label: 'HGETALL', id: 'hgetall' },
        { label: 'INCR', id: 'incr' },
        { label: 'INCRBY', id: 'incrby' },
        { label: 'EXISTS', id: 'exists' },
        { label: 'SETNX', id: 'setnx' },
        { label: 'LPUSH', id: 'lpush' },
        { label: 'LRANGE', id: 'lrange' },
        { label: 'EXPIRE', id: 'expire' },
        { label: 'TTL', id: 'ttl' },
        { label: 'Command', id: 'command' },
      ],
      value: () => 'get',
    },
    {
      id: 'restUrl',
      title: 'REST URL',
      type: 'short-input',
      placeholder: 'https://your-database.upstash.io',
      password: true,
      required: true,
    },
    {
      id: 'restToken',
      title: 'REST Token',
      type: 'short-input',
      placeholder: 'Enter your Upstash Redis REST token',
      password: true,
      required: true,
    },
    // Key field (used by most operations)
    {
      id: 'key',
      title: 'Key',
      type: 'short-input',
      placeholder: 'my-key',
      condition: {
        field: 'operation',
        value: [
          'get',
          'set',
          'delete',
          'hset',
          'hget',
          'hgetall',
          'incr',
          'incrby',
          'exists',
          'setnx',
          'lpush',
          'lrange',
          'expire',
          'ttl',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'get',
          'set',
          'delete',
          'hset',
          'hget',
          'hgetall',
          'incr',
          'incrby',
          'exists',
          'setnx',
          'lpush',
          'lrange',
          'expire',
          'ttl',
        ],
      },
    },
    // Value field (Get/Set/HSET/LPUSH)
    {
      id: 'value',
      title: 'Value',
      type: 'long-input',
      placeholder: 'Value to store',
      condition: { field: 'operation', value: ['set', 'setnx', 'hset', 'lpush'] },
      required: { field: 'operation', value: ['set', 'setnx', 'hset', 'lpush'] },
    },
    // Expiration for SET
    {
      id: 'ex',
      title: 'Expiration (seconds)',
      type: 'short-input',
      placeholder: 'Optional TTL in seconds',
      condition: { field: 'operation', value: 'set' },
      mode: 'advanced',
    },
    // Hash field (HSET/HGET)
    {
      id: 'field',
      title: 'Field',
      type: 'short-input',
      placeholder: 'Hash field name',
      condition: { field: 'operation', value: ['hset', 'hget'] },
      required: { field: 'operation', value: ['hset', 'hget'] },
    },
    // Pattern for KEYS
    {
      id: 'pattern',
      title: 'Pattern',
      type: 'short-input',
      placeholder: '* (all keys) or user:* (prefix match)',
      condition: { field: 'operation', value: 'keys' },
      mode: 'advanced',
    },
    // Seconds for EXPIRE
    {
      id: 'seconds',
      title: 'Seconds',
      type: 'short-input',
      placeholder: 'Timeout in seconds',
      condition: { field: 'operation', value: 'expire' },
      required: { field: 'operation', value: 'expire' },
    },
    // Increment for INCRBY
    {
      id: 'increment',
      title: 'Increment',
      type: 'short-input',
      placeholder: 'Amount to increment by (negative to decrement)',
      condition: { field: 'operation', value: 'incrby' },
      required: { field: 'operation', value: 'incrby' },
    },
    // Start/Stop for LRANGE
    {
      id: 'start',
      title: 'Start Index',
      type: 'short-input',
      placeholder: '0',
      condition: { field: 'operation', value: 'lrange' },
      required: { field: 'operation', value: 'lrange' },
      mode: 'advanced',
    },
    {
      id: 'stop',
      title: 'Stop Index',
      type: 'short-input',
      placeholder: '-1 (all elements)',
      condition: { field: 'operation', value: 'lrange' },
      required: { field: 'operation', value: 'lrange' },
      mode: 'advanced',
    },
    // Command for raw Redis
    {
      id: 'command',
      title: 'Command',
      type: 'code',
      placeholder: '["HSET", "myhash", "field1", "value1"]',
      condition: { field: 'operation', value: 'command' },
      required: { field: 'operation', value: 'command' },
    },
  ],
  tools: {
    access: [
      'upstash_redis_get',
      'upstash_redis_set',
      'upstash_redis_delete',
      'upstash_redis_keys',
      'upstash_redis_command',
      'upstash_redis_hset',
      'upstash_redis_hget',
      'upstash_redis_hgetall',
      'upstash_redis_incr',
      'upstash_redis_expire',
      'upstash_redis_ttl',
      'upstash_redis_lpush',
      'upstash_redis_lrange',
      'upstash_redis_exists',
      'upstash_redis_setnx',
      'upstash_redis_incrby',
    ],
    config: {
      tool: (params) => {
        if (params.ex) {
          params.ex = Number(params.ex)
        }
        if (params.seconds !== undefined) {
          params.seconds = Number(params.seconds)
        }
        if (params.start !== undefined) {
          params.start = Number(params.start)
        }
        if (params.stop !== undefined) {
          params.stop = Number(params.stop)
        }
        if (params.increment !== undefined) {
          params.increment = Number(params.increment)
        }
        return `upstash_redis_${params.operation}`
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Redis operation to perform' },
    restUrl: { type: 'string', description: 'Upstash Redis REST URL' },
    restToken: { type: 'string', description: 'Upstash Redis REST token' },
    key: { type: 'string', description: 'Redis key' },
    value: { type: 'string', description: 'Value to store' },
    ex: { type: 'number', description: 'Expiration time in seconds (SET)' },
    field: { type: 'string', description: 'Hash field name (HSET/HGET)' },
    pattern: { type: 'string', description: 'Pattern to match keys (KEYS)' },
    seconds: { type: 'number', description: 'Timeout in seconds (EXPIRE)' },
    start: { type: 'number', description: 'Start index (LRANGE)' },
    stop: { type: 'number', description: 'Stop index (LRANGE)' },
    command: { type: 'string', description: 'Redis command as JSON array (Command)' },
    increment: { type: 'number', description: 'Amount to increment by (INCRBY)' },
  },
  outputs: {
    value: { type: 'json', description: 'Retrieved value (Get, HGET, INCR, INCRBY operations)' },
    result: {
      type: 'json',
      description: 'Operation result (Set, HSET, EXPIRE, Command operations)',
    },
    deletedCount: { type: 'number', description: 'Number of keys deleted (Delete operation)' },
    keys: { type: 'array', description: 'List of keys matching the pattern (Keys operation)' },
    count: { type: 'number', description: 'Number of items found (Keys, LRANGE operations)' },
    key: { type: 'string', description: 'The key operated on' },
    fields: {
      type: 'json',
      description: 'Hash field-value pairs keyed by field name (HGETALL operation)',
    },
    fieldCount: { type: 'number', description: 'Number of fields in the hash (HGETALL operation)' },
    field: { type: 'string', description: 'Hash field name (HSET, HGET operations)' },
    ttl: {
      type: 'number',
      description:
        'Remaining TTL in seconds. Positive integer if TTL set, -1 if no expiration, -2 if key does not exist.',
    },
    length: { type: 'number', description: 'List length after push (LPUSH operation)' },
    values: {
      type: 'array',
      description: 'List elements in the specified range (LRANGE operation)',
    },
    command: { type: 'string', description: 'The command that was executed (Command operation)' },
    pattern: { type: 'string', description: 'The pattern used to match keys (Keys operation)' },
    exists: {
      type: 'boolean',
      description: 'Whether the key exists (true) or not (false) (EXISTS operation)',
    },
    wasSet: {
      type: 'boolean',
      description: 'Whether the key was set (true) or already existed (false) (SETNX operation)',
    },
  },
}

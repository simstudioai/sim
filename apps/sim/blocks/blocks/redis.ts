import { RedisIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type {
  RedisCommandResponse,
  RedisDeleteResponse,
  RedisExistsResponse,
  RedisExpireResponse,
  RedisGetResponse,
  RedisHDelResponse,
  RedisHGetAllResponse,
  RedisHGetResponse,
  RedisHSetResponse,
  RedisIncrbyResponse,
  RedisIncrResponse,
  RedisKeysResponse,
  RedisLLenResponse,
  RedisLPopResponse,
  RedisLPushResponse,
  RedisLRangeResponse,
  RedisPersistResponse,
  RedisRPopResponse,
  RedisRPushResponse,
  RedisSetnxResponse,
  RedisSetResponse,
  RedisTtlResponse,
} from '@/tools/redis/types'

type RedisResponse =
  | RedisGetResponse
  | RedisSetResponse
  | RedisDeleteResponse
  | RedisKeysResponse
  | RedisCommandResponse
  | RedisHSetResponse
  | RedisHGetResponse
  | RedisHGetAllResponse
  | RedisHDelResponse
  | RedisIncrResponse
  | RedisIncrbyResponse
  | RedisExpireResponse
  | RedisTtlResponse
  | RedisPersistResponse
  | RedisLPushResponse
  | RedisRPushResponse
  | RedisLPopResponse
  | RedisRPopResponse
  | RedisLLenResponse
  | RedisLRangeResponse
  | RedisExistsResponse
  | RedisSetnxResponse

const KEY_OPERATIONS = [
  'get',
  'set',
  'delete',
  'hset',
  'hget',
  'hgetall',
  'hdel',
  'incr',
  'incrby',
  'exists',
  'setnx',
  'lpush',
  'rpush',
  'lpop',
  'rpop',
  'llen',
  'lrange',
  'expire',
  'persist',
  'ttl',
] as const

export const RedisBlock: BlockConfig<RedisResponse> = {
  type: 'redis',
  name: 'Redis',
  description: 'Key-value operations with Redis',
  longDescription:
    'Connect to any Redis instance to perform key-value, hash, list, and utility operations via a direct connection.',
  docsLink: 'https://docs.sim.ai/tools/redis',
  category: 'tools',
  bgColor: '#FF4438',
  authMode: AuthMode.ApiKey,
  icon: RedisIcon,
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
        { label: 'HDEL', id: 'hdel' },
        { label: 'INCR', id: 'incr' },
        { label: 'INCRBY', id: 'incrby' },
        { label: 'EXISTS', id: 'exists' },
        { label: 'SETNX', id: 'setnx' },
        { label: 'LPUSH', id: 'lpush' },
        { label: 'RPUSH', id: 'rpush' },
        { label: 'LPOP', id: 'lpop' },
        { label: 'RPOP', id: 'rpop' },
        { label: 'LLEN', id: 'llen' },
        { label: 'LRANGE', id: 'lrange' },
        { label: 'EXPIRE', id: 'expire' },
        { label: 'PERSIST', id: 'persist' },
        { label: 'TTL', id: 'ttl' },
        { label: 'Command', id: 'command' },
      ],
      value: () => 'get',
    },
    {
      id: 'url',
      title: 'Connection URL',
      type: 'short-input',
      placeholder: 'redis://user:password@host:port',
      password: true,
      required: true,
    },
    {
      id: 'key',
      title: 'Key',
      type: 'short-input',
      placeholder: 'my-key',
      condition: {
        field: 'operation',
        value: [...KEY_OPERATIONS],
      },
      required: {
        field: 'operation',
        value: [...KEY_OPERATIONS],
      },
    },
    {
      id: 'value',
      title: 'Value',
      type: 'long-input',
      placeholder: 'Value to store',
      condition: { field: 'operation', value: ['set', 'setnx', 'hset', 'lpush', 'rpush'] },
      required: { field: 'operation', value: ['set', 'setnx', 'hset', 'lpush', 'rpush'] },
    },
    {
      id: 'ex',
      title: 'Expiration (seconds)',
      type: 'short-input',
      placeholder: 'Optional TTL in seconds',
      condition: { field: 'operation', value: 'set' },
      mode: 'advanced',
    },
    {
      id: 'field',
      title: 'Field',
      type: 'short-input',
      placeholder: 'Hash field name',
      condition: { field: 'operation', value: ['hset', 'hget', 'hdel'] },
      required: { field: 'operation', value: ['hset', 'hget', 'hdel'] },
    },
    {
      id: 'pattern',
      title: 'Pattern',
      type: 'short-input',
      placeholder: '* (all keys) or user:* (prefix match)',
      condition: { field: 'operation', value: 'keys' },
      mode: 'advanced',
    },
    {
      id: 'seconds',
      title: 'Seconds',
      type: 'short-input',
      placeholder: 'Timeout in seconds',
      condition: { field: 'operation', value: 'expire' },
      required: { field: 'operation', value: 'expire' },
    },
    {
      id: 'increment',
      title: 'Increment',
      type: 'short-input',
      placeholder: 'Amount to increment by (negative to decrement)',
      condition: { field: 'operation', value: 'incrby' },
      required: { field: 'operation', value: 'incrby' },
    },
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
      'redis_get',
      'redis_set',
      'redis_delete',
      'redis_keys',
      'redis_command',
      'redis_hset',
      'redis_hget',
      'redis_hgetall',
      'redis_hdel',
      'redis_incr',
      'redis_incrby',
      'redis_expire',
      'redis_ttl',
      'redis_persist',
      'redis_lpush',
      'redis_rpush',
      'redis_lpop',
      'redis_rpop',
      'redis_llen',
      'redis_lrange',
      'redis_exists',
      'redis_setnx',
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
        return `redis_${params.operation}`
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Redis operation to perform' },
    url: { type: 'string', description: 'Redis connection URL' },
    key: { type: 'string', description: 'Redis key' },
    value: { type: 'string', description: 'Value to store' },
    ex: { type: 'number', description: 'Expiration time in seconds (SET)' },
    field: { type: 'string', description: 'Hash field name (HSET/HGET/HDEL)' },
    pattern: { type: 'string', description: 'Pattern to match keys (KEYS)' },
    seconds: { type: 'number', description: 'Timeout in seconds (EXPIRE)' },
    start: { type: 'number', description: 'Start index (LRANGE)' },
    stop: { type: 'number', description: 'Stop index (LRANGE)' },
    command: { type: 'string', description: 'Redis command as JSON array (Command)' },
    increment: { type: 'number', description: 'Amount to increment by (INCRBY)' },
  },
  outputs: {
    value: {
      type: 'json',
      description:
        'Retrieved value (Get, HGET, LPOP, RPOP: string or null) or new value after increment (INCR, INCRBY: number)',
    },
    result: {
      type: 'json',
      description: 'Operation result (Set, HSET, EXPIRE, PERSIST, Command operations)',
    },
    deletedCount: { type: 'number', description: 'Number of keys deleted (Delete operation)' },
    deleted: { type: 'number', description: 'Number of fields deleted (HDEL operation)' },
    keys: { type: 'array', description: 'List of keys matching the pattern (Keys operation)' },
    count: { type: 'number', description: 'Number of items found (Keys, LRANGE operations)' },
    key: { type: 'string', description: 'The key operated on' },
    fields: {
      type: 'json',
      description: 'Hash field-value pairs keyed by field name (HGETALL operation)',
    },
    fieldCount: { type: 'number', description: 'Number of fields in the hash (HGETALL operation)' },
    field: { type: 'string', description: 'Hash field name (HSET, HGET, HDEL operations)' },
    ttl: {
      type: 'number',
      description:
        'Remaining TTL in seconds. Positive integer if TTL set, -1 if no expiration, -2 if key does not exist.',
    },
    length: {
      type: 'number',
      description: 'List length (LPUSH, RPUSH, LLEN operations)',
    },
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

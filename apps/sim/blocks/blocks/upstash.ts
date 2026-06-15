import { UpstashIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
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
  docsLink: 'https://docs.sim.ai/integrations/upstash',
  category: 'tools',
  integrationType: IntegrationType.Databases,
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
        switch (params.operation) {
          case 'get':
            return 'upstash_redis_get'
          case 'set':
            return 'upstash_redis_set'
          case 'delete':
            return 'upstash_redis_delete'
          case 'keys':
            return 'upstash_redis_keys'
          case 'command':
            return 'upstash_redis_command'
          case 'hset':
            return 'upstash_redis_hset'
          case 'hget':
            return 'upstash_redis_hget'
          case 'hgetall':
            return 'upstash_redis_hgetall'
          case 'incr':
            return 'upstash_redis_incr'
          case 'incrby':
            return 'upstash_redis_incrby'
          case 'exists':
            return 'upstash_redis_exists'
          case 'setnx':
            return 'upstash_redis_setnx'
          case 'lpush':
            return 'upstash_redis_lpush'
          case 'lrange':
            return 'upstash_redis_lrange'
          case 'expire':
            return 'upstash_redis_expire'
          case 'ttl':
            return 'upstash_redis_ttl'
          default:
            throw new Error(`Unknown operation: ${params.operation}`)
        }
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

export const UpstashBlockMeta = {
  tags: ['cloud'],
  url: 'https://upstash.com',
  templates: [
    {
      icon: UpstashIcon,
      title: 'Upstash key TTL hygiene',
      prompt:
        'Build a scheduled workflow that pulls Upstash Redis keys without TTLs, flags those that should expire, and either sets a TTL or routes to engineering for review.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'automation'],
    },
    {
      icon: UpstashIcon,
      title: 'Upstash counter digest',
      prompt:
        'Create a scheduled daily workflow that reads Upstash Redis counter keys for the day, summarizes the totals, and posts a usage digest to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['monitoring', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: UpstashIcon,
      title: 'Upstash queue drain',
      prompt:
        'Build a scheduled workflow that pops queued jobs from an Upstash Redis list with LRANGE, transforms each into structured rows, and writes them into a downstream Sim table for further automation.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'sync'],
    },
    {
      icon: UpstashIcon,
      title: 'Upstash + Vercel cache invalidator',
      prompt:
        'Create a workflow triggered by a Vercel production deploy that flushes targeted Upstash cache keys for changed routes, so users never see stale responses post-deploy.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'automation'],
      alsoIntegrations: ['vercel'],
    },
    {
      icon: UpstashIcon,
      title: 'Upstash key integrity check',
      prompt:
        'Build a scheduled workflow that reads a set of critical Upstash Redis keys, compares each value against the expected baseline in a table, and writes a mismatch report to an SRE audit table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'enterprise'],
    },
    {
      icon: UpstashIcon,
      title: 'Upstash cache warmer',
      prompt:
        'Create a scheduled workflow that precomputes expensive query results and writes them into Upstash Redis with a TTL using SET, so hot paths stay warm and pages PagerDuty if a warm-up run fails.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'automation'],
      alsoIntegrations: ['pagerduty'],
    },
    {
      icon: UpstashIcon,
      title: 'Upstash + DynamoDB hybrid store',
      prompt:
        'Create a workflow that uses Upstash for hot keys and DynamoDB for cold storage, transparently promotes/demotes records based on access frequency.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'automation'],
      alsoIntegrations: ['dynamodb'],
    },
  ],
  skills: [
    {
      name: 'cache-value-with-ttl',
      description:
        'Store a value in Upstash Redis under a key with an expiration so it auto-evicts.',
      content:
        '# Cache a Value with TTL\n\nWrite a computed or fetched value into Redis so hot paths read it fast and it expires automatically.\n\n## Steps\n1. Use the Set operation with your REST URL and REST Token.\n2. Provide the Key (for example user:123:profile) and the Value to store.\n3. Set the Expiration (seconds) so the entry self-evicts after the TTL.\n4. To avoid overwriting an existing entry, use SETNX instead, which only sets when the key is absent.\n\n## Output\nReturn the set result so the cache write can be confirmed before downstream reads.',
    },
    {
      name: 'read-cached-value',
      description: 'Read a value from Upstash Redis by key, returning a cache hit or miss.',
      content:
        '# Read a Cached Value\n\nLook up a key in Redis and branch on whether it is present.\n\n## Steps\n1. Use the Get operation with the REST URL, REST Token, and the Key.\n2. To check presence first without fetching, use EXISTS, or use TTL to see how long the entry has left.\n3. On a cache miss (no value), fall through to recompute and write it back with Set.\n\n## Output\nReturn the retrieved value, or an empty result on a miss, so the workflow can serve cached data or recompute.',
    },
    {
      name: 'increment-counter',
      description:
        'Atomically increment an Upstash Redis counter for rate limits or usage metering.',
      content:
        '# Increment a Redis Counter\n\nMaintain an atomic counter for usage tracking, rate limiting, or tallies.\n\n## Steps\n1. Use the INCR operation with the REST URL, REST Token, and the counter Key to add one.\n2. Use INCRBY with an Increment amount to add (or subtract with a negative value) a specific number.\n3. Pair with the EXPIRE operation on the key to create a time-windowed counter (for example per-minute rate limits).\n\n## Output\nReturn the new counter value after the increment so the workflow can check it against a threshold.',
    },
    {
      name: 'push-and-read-list',
      description:
        'Push items onto an Upstash Redis list and read a range back for a simple queue.',
      content:
        '# Push and Read a Redis List\n\nUse a Redis list as a lightweight queue or activity log.\n\n## Steps\n1. Use the LPUSH operation with the REST URL, REST Token, Key, and Value to add an item to the list head.\n2. Use the LRANGE operation with a Start Index (0) and Stop Index (-1 for all) to read items back.\n3. For raw or unsupported operations, use the Command operation with a JSON array like ["RPOP", "myqueue"].\n\n## Output\nReturn the list length after a push and the list elements from a range read so the workflow can process queued items.',
    },
  ],
} as const satisfies BlockMeta

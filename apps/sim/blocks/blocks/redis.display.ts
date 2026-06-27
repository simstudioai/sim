import { RedisIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const RedisBlockDisplay = {
  type: 'redis',
  name: 'Redis',
  description: 'Key-value operations with Redis',
  category: 'tools',
  bgColor: '#FF4438',
  icon: RedisIcon,
  iconColor: '#FF4438',
  longDescription:
    'Connect to any Redis instance to perform key-value, hash, list, and utility operations via a direct connection.',
  docsLink: 'https://docs.sim.ai/integrations/redis',
  integrationType: IntegrationType.Databases,
} satisfies BlockDisplay

export const RedisBlockMeta = {
  tags: ['cloud'],
  url: 'https://redis.io',
  templates: [
    {
      icon: RedisIcon,
      title: 'Redis response cache',
      prompt:
        'Build a workflow that checks Redis for a cached result by key before running an expensive step, and writes the computed result back with a TTL when there is a miss so repeat requests stay fast.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'devops'],
    },
    {
      icon: RedisIcon,
      title: 'Redis rate limiter',
      prompt:
        'Create a workflow that increments a per-user Redis counter on each request, sets an expiry on the first hit, and blocks the request when the counter passes the allowed threshold within the window.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'automation'],
    },
    {
      icon: RedisIcon,
      title: 'Redis feature-flag reader',
      prompt:
        'Build a workflow that reads feature-flag values from a Redis hash, branches downstream logic on whether each flag is enabled, and falls back to a default when a flag key is missing.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'automation'],
    },
    {
      icon: RedisIcon,
      title: 'Redis job queue worker',
      prompt:
        'Create a scheduled workflow that pops the next job off a Redis list, processes it with an agent, and writes the outcome to a table so a backlog of work is drained on an interval.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'automation'],
    },
    {
      icon: RedisIcon,
      title: 'Redis cache warmer',
      prompt:
        'Build a scheduled workflow that reads a list of hot keys from a table and sets each one in Redis with fresh values and a TTL, so popular lookups stay warm.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'automation'],
    },
    {
      icon: RedisIcon,
      title: 'Redis daily counter digest',
      prompt:
        'Create a scheduled workflow that reads the day’s Redis counters by key pattern, builds a summary of the totals with an agent, and posts the digest to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: RedisIcon,
      title: 'Redis session lookup',
      prompt:
        'Build a workflow that reads a session hash from Redis by token, returns the stored user context to the caller, and refreshes the key’s expiry so active sessions stay alive.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'automation'],
    },
  ],
  skills: [
    {
      name: 'cache-with-expiry',
      description: 'Cache a computed value in Redis with a TTL and read it back on later runs.',
      content:
        '# Cache With Expiry\n\nStore an expensive result in Redis so later runs reuse it.\n\n## Steps\n1. Run get on the cache key first; if a value is returned, use it and stop.\n2. On a miss, compute the value, then run set with an ex expiry in seconds.\n3. Use setnx instead of set when only the first writer should win.\n4. Return the value to the caller.\n\n## Output\nReport whether the result was a cache hit or a fresh computation, and the key TTL.',
    },
    {
      name: 'rate-limit-counter',
      description: 'Track per-key request counts in Redis with a sliding expiry to enforce limits.',
      content:
        '# Rate Limit Counter\n\nEnforce a request budget using a Redis counter.\n\n## Steps\n1. Run incr on a counter key derived from the user or client id.\n2. If the returned count is 1, run expire to start the window.\n3. Compare the count to the allowed limit.\n4. Allow or reject the request based on the result.\n\n## Output\nReturn the current count, the limit, and whether the request is allowed. Include ttl for the reset time.',
    },
    {
      name: 'manage-session-data',
      description: 'Store and refresh session context in a Redis hash keyed by token.',
      content:
        '# Manage Session Data\n\nKeep session state in a Redis hash and keep active sessions alive.\n\n## Steps\n1. On write, run hset to store session fields under the session key.\n2. On read, run hgetall by token to return the full session context.\n3. Run expire to refresh the TTL so active sessions do not lapse.\n4. Run delete on logout to clear the session.\n\n## Output\nReturn the session context and confirm the refreshed expiry, or confirm deletion on logout.',
    },
    {
      name: 'manage-work-queue',
      description: 'Push jobs onto a Redis list and pop them for processing in order.',
      content:
        '# Manage Work Queue\n\nUse a Redis list as a simple job queue.\n\n## Steps\n1. Run rpush to enqueue a job payload onto the queue key.\n2. Run lpop to dequeue the next job for processing (FIFO).\n3. Check llen to monitor backlog depth.\n4. Use lrange to inspect pending jobs without removing them.\n\n## Output\nReturn the dequeued job, the remaining queue length, and processing status.',
    },
  ],
} as const satisfies BlockMeta

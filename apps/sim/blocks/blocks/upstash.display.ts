import { UpstashIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const UpstashBlockDisplay = {
  type: 'upstash',
  name: 'Upstash',
  description: 'Serverless Redis with Upstash',
  category: 'tools',
  bgColor: '#181C1E',
  icon: UpstashIcon,
  longDescription:
    'Connect to Upstash Redis to perform key-value, hash, list, and utility operations via the REST API.',
  docsLink: 'https://docs.sim.ai/integrations/upstash',
  integrationType: IntegrationType.Databases,
} satisfies BlockDisplay

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

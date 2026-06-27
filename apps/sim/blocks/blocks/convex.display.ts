import { ConvexIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const ConvexBlockDisplay = {
  type: 'convex',
  name: 'Convex',
  description: 'Use Convex database',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: ConvexIcon,
  longDescription:
    'Integrate Convex into the workflow. Run query, mutation, and action functions on your deployment, list tables with their schemas, and export documents with snapshot pagination and change deltas.',
  docsLink: 'https://docs.sim.ai/integrations/convex',
  integrationType: IntegrationType.Databases,
} satisfies BlockDisplay

export const ConvexBlockMeta = {
  tags: ['cloud'],
  url: 'https://www.convex.dev',
  templates: [
    {
      icon: ConvexIcon,
      title: 'Convex support ticket triage',
      prompt:
        'Build a workflow that runs a Convex query to fetch open support tickets, classifies each by urgency with an agent, writes the triage label back via a Convex mutation, and posts critical tickets to Slack.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['automation', 'customer-support'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: ConvexIcon,
      title: 'Convex nightly backup to S3',
      prompt:
        'Create a scheduled workflow that runs each night, pages through every Convex table with List Documents, writes the exported JSON to S3 with date partitions, and records the run in an audit table.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'sync'],
      alsoIntegrations: ['s3'],
    },
    {
      icon: ConvexIcon,
      title: 'Convex change-data alerting',
      prompt:
        'Build a scheduled workflow that polls Convex Document Deltas for changed rows since the last run, filters for high-value records like fraud flags or large orders, and posts an alert with context to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['monitoring', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: ConvexIcon,
      title: 'Convex user onboarding automation',
      prompt:
        'Create a workflow that receives new-signup webhooks, runs a Convex mutation to provision the user record with defaults, and sends a personalized welcome email.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['automation', 'email'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: ConvexIcon,
      title: 'Convex daily metrics digest',
      prompt:
        'Create a scheduled daily workflow that runs Convex queries for new signups, active users, and key feature usage, summarizes the numbers with an agent, and posts a digest to Slack with day-over-day trend.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['reporting', 'product'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: ConvexIcon,
      title: 'Convex search index sync',
      prompt:
        'Build a scheduled workflow that uses Convex Document Deltas to mirror changed documents into an Algolia index, removes deleted documents, and writes sync lag to a tables-based monitor.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'sync'],
      alsoIntegrations: ['algolia'],
    },
    {
      icon: ConvexIcon,
      title: 'Convex schema drift monitor',
      prompt:
        'Create a scheduled workflow that runs Convex List Tables, diffs the returned table schemas against the last snapshot stored in a table, and notifies the engineering channel when fields are added, removed, or change type.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'run-convex-function',
      description:
        'Run a Convex query, mutation, or action with named arguments and use its result.',
      content:
        '# Run a Convex Function\n\nCall a function deployed to Convex and work with its return value.\n\n## Steps\n1. Pick the operation that matches the function type: Run Query for reads, Run Mutation for writes, Run Action for side effects like calling external APIs.\n2. Provide the Deployment URL (https://your-deployment.convex.cloud) and a deploy key from the dashboard Settings page.\n3. Set Function Path in module:function form, for example messages:list or tasks/admin:reset.\n4. Pass Function Arguments as a JSON object whose keys match the argument names the function declares, for example {"limit": 10}.\n\n## Output\nThe function result is available as value, with any console output in logLines. Surface the fields downstream steps need.',
    },
    {
      name: 'export-convex-table',
      description:
        'Page through a full Convex table snapshot with List Documents until hasMore is false.',
      content:
        '# Export a Convex Table\n\nRead every document in a table using snapshot pagination so the export is consistent.\n\n## Steps\n1. Use the List Documents operation with the deployment URL, deploy key, and the table name (leave empty to export all tables).\n2. On the first call leave Snapshot and Cursor empty; the response pins a snapshot timestamp.\n3. While hasMore is true, call List Documents again passing back the returned snapshot and pageCursor values.\n4. Collect the documents arrays from each page into your destination.\n\n## Output\nA complete, point-in-time set of documents for the table, each including _id and _creationTime.',
    },
    {
      name: 'sync-convex-changes',
      description: 'Fetch only changed Convex documents since a snapshot using Document Deltas.',
      content:
        '# Sync Convex Changes Incrementally\n\nAfter an initial export, keep a downstream copy fresh by reading only what changed.\n\n## Steps\n1. Run an initial export with List Documents and keep the final snapshot value.\n2. On each sync run, call Document Deltas with that value as the Cursor (and optionally a table name).\n3. While hasMore is true, keep calling Document Deltas with the returned cursor; persist the last cursor for the next run.\n4. Apply each document by _id; documents with _deleted set to true should be removed downstream.\n\n## Output\nThe changed documents since the stored cursor plus a new cursor to persist, giving reliable incremental sync when documents are applied idempotently by _id.',
    },
  ],
} as const satisfies BlockMeta

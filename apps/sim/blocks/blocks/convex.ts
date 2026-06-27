import { ConvexIcon } from '@/components/icons'
import { ConvexBlockDisplay } from '@/blocks/blocks/convex.display'
import { AuthMode, type BlockConfig, type BlockMeta } from '@/blocks/types'
import type { ConvexResponse } from '@/tools/convex/types'

export const ConvexBlock: BlockConfig<ConvexResponse> = {
  ...ConvexBlockDisplay,
  authMode: AuthMode.ApiKey,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Run Query', id: 'query' },
        { label: 'Run Mutation', id: 'mutation' },
        { label: 'Run Action', id: 'action' },
        { label: 'Run Function', id: 'run_function' },
        { label: 'List Tables', id: 'list_tables' },
        { label: 'List Documents', id: 'list_documents' },
        { label: 'Document Deltas', id: 'document_deltas' },
      ],
      value: () => 'query',
    },
    {
      id: 'deploymentUrl',
      title: 'Deployment URL',
      type: 'short-input',
      placeholder: 'https://your-deployment.convex.cloud',
      required: true,
    },
    {
      id: 'deployKey',
      title: 'Deploy Key',
      type: 'short-input',
      placeholder: 'Your Convex deploy key',
      password: true,
      required: true,
    },
    {
      id: 'functionPath',
      title: 'Function Path',
      type: 'short-input',
      placeholder: 'messages:list',
      condition: { field: 'operation', value: ['query', 'mutation', 'action', 'run_function'] },
      required: true,
    },
    {
      id: 'args',
      title: 'Function Arguments',
      type: 'code',
      placeholder: '{\n  "key": "value"\n}',
      condition: { field: 'operation', value: ['query', 'mutation', 'action', 'run_function'] },
      wandConfig: {
        enabled: true,
        maintainHistory: true,
        prompt: `Generate a JSON object of named arguments for a Convex function based on the user's request.

### CONTEXT
{context}

### RULES
- Convex functions take a single object of named arguments
- Keys must match the argument names declared by the function
- Values must be JSON-serializable (strings, numbers, booleans, arrays, objects, null)

### EXAMPLES
"send a message saying hello from sim" -> {"body": "hello from sim", "author": "sim"}
"list the 10 most recent items" -> {"limit": 10}

Return ONLY the JSON object - no explanations, no markdown, no extra text.`,
        placeholder: 'Describe the arguments to pass...',
        generationType: 'json-object',
      },
    },
    {
      id: 'tableName',
      title: 'Table',
      type: 'short-input',
      placeholder: 'Table name (leave empty for all tables)',
      condition: { field: 'operation', value: ['list_documents', 'document_deltas'] },
    },
    {
      id: 'cursor',
      title: 'Cursor',
      type: 'short-input',
      placeholder: 'Snapshot value from List Documents or cursor from a previous page',
      condition: { field: 'operation', value: 'document_deltas' },
      required: true,
    },
    {
      id: 'snapshot',
      title: 'Snapshot',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'Snapshot timestamp from a previous page',
      condition: { field: 'operation', value: 'list_documents' },
    },
    {
      id: 'pageCursor',
      title: 'Cursor',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'Cursor from a previous page',
      condition: { field: 'operation', value: 'list_documents' },
    },
  ],
  tools: {
    access: [
      'convex_query',
      'convex_mutation',
      'convex_action',
      'convex_run_function',
      'convex_list_tables',
      'convex_list_documents',
      'convex_document_deltas',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'query':
            return 'convex_query'
          case 'mutation':
            return 'convex_mutation'
          case 'action':
            return 'convex_action'
          case 'run_function':
            return 'convex_run_function'
          case 'list_tables':
            return 'convex_list_tables'
          case 'list_documents':
            return 'convex_list_documents'
          case 'document_deltas':
            return 'convex_document_deltas'
          default:
            throw new Error(`Invalid Convex operation: ${params.operation}`)
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    deploymentUrl: { type: 'string', description: 'Convex deployment URL' },
    deployKey: { type: 'string', description: 'Convex deploy key' },
    functionPath: { type: 'string', description: 'Function path (e.g., messages:list)' },
    args: { type: 'json', description: 'Named arguments for the function' },
    tableName: { type: 'string', description: 'Table to read from (empty for all tables)' },
    snapshot: { type: 'string', description: 'Snapshot timestamp for List Documents pagination' },
    cursor: { type: 'string', description: 'Timestamp cursor for Document Deltas' },
    pageCursor: { type: 'string', description: 'Page cursor for List Documents pagination' },
  },
  outputs: {
    value: {
      type: 'json',
      description: 'Result returned by the query, mutation, or action function',
    },
    logLines: {
      type: 'array',
      description: 'Log lines printed during the function execution',
    },
    tables: {
      type: 'array',
      description: 'Names of the tables in the deployment',
    },
    schemas: {
      type: 'json',
      description: 'Map of table name to the JSON schema of its documents',
    },
    documents: {
      type: 'array',
      description: 'Documents returned by List Documents or Document Deltas',
    },
    hasMore: {
      type: 'boolean',
      description: 'Whether more pages remain',
    },
    snapshot: {
      type: 'string',
      description: 'Snapshot timestamp to pass back in for the next List Documents page',
    },
    pageCursor: {
      type: 'string',
      description: 'Page cursor to pass back in for the next List Documents page',
    },
    cursor: {
      type: 'string',
      description: 'Timestamp cursor to pass back in for the next Document Deltas page',
    },
  },
}

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

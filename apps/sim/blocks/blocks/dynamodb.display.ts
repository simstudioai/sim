import { DynamoDBIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const DynamoDBBlockDisplay = {
  type: 'dynamodb',
  name: 'Amazon DynamoDB',
  description: 'Get, put, query, scan, update, and delete items in Amazon DynamoDB tables',
  category: 'tools',
  bgColor: 'linear-gradient(45deg, #2E27AD 0%, #527FFF 100%)',
  icon: DynamoDBIcon,
  iconColor: '#527FFF',
  longDescription:
    'Integrate Amazon DynamoDB into workflows. Supports Get, Put, Query, Scan, Update, Delete, and Introspect operations on DynamoDB tables.',
  docsLink: 'https://docs.sim.ai/integrations/dynamodb',
  integrationType: IntegrationType.Databases,
} satisfies BlockDisplay

export const DynamoDBBlockMeta = {
  tags: ['cloud', 'data-analytics'],
  url: 'https://aws.amazon.com/dynamodb',
  templates: [
    {
      icon: DynamoDBIcon,
      title: 'DynamoDB hot-partition watcher',
      prompt:
        'Build a scheduled workflow that pulls DynamoDB CloudWatch metrics, identifies hot partitions and throttled requests, and writes the report to a Slack channel with mitigation suggestions.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring'],
      alsoIntegrations: ['cloudwatch', 'slack'],
    },
    {
      icon: DynamoDBIcon,
      title: 'DynamoDB TTL backfill',
      prompt:
        'Create a workflow that scans a DynamoDB table for items missing the TTL attribute, computes the correct TTL based on creation time, and updates in batches with throttling.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'automation'],
    },
    {
      icon: DynamoDBIcon,
      title: 'DynamoDB to S3 archive',
      prompt:
        'Build a scheduled workflow that exports DynamoDB items older than the retention horizon to S3 with Parquet partitioning and removes the rows from the table, writing the archive manifest.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'sync'],
      alsoIntegrations: ['s3'],
    },
    {
      icon: DynamoDBIcon,
      title: 'DynamoDB change publisher',
      prompt:
        'Create a scheduled workflow that scans a DynamoDB table for items changed since the last run, transforms each into a typed event, and publishes it to an SQS queue for downstream processing.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'automation'],
      alsoIntegrations: ['sqs'],
    },
    {
      icon: DynamoDBIcon,
      title: 'DynamoDB capacity recommender',
      prompt:
        'Build a scheduled weekly workflow that analyzes DynamoDB capacity consumption, recommends switches between provisioned and on-demand per table, and writes the savings projection to a finance review file.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['finance', 'devops'],
    },
    {
      icon: DynamoDBIcon,
      title: 'DynamoDB GSI health audit',
      prompt:
        'Create a scheduled workflow that scans DynamoDB GSIs for skew, low projection efficiency, and unused indexes, and writes a remediation plan to engineering Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'analysis'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: DynamoDBIcon,
      title: 'DynamoDB + Athena unified analytics',
      prompt:
        'Create a workflow that exports DynamoDB tables nightly into Athena-queryable Parquet, registers the schema, and writes a sample query for analyst use.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['analysis', 'sync'],
      alsoIntegrations: ['athena'],
    },
  ],
  skills: [
    {
      name: 'lookup-item-by-key',
      description:
        'Get a single DynamoDB item by its primary key and return the requested attributes.',
      content:
        '# Lookup Item by Key\n\nRetrieve one record from a DynamoDB table by its key.\n\n## Steps\n1. Identify the table and the partition key (and sort key if the table uses one).\n2. Get the item by its key.\n3. Return the requested attributes, or report that no item exists for that key.\n\n## Output\nThe item attributes if found, or a clear "not found" result. Do not fabricate values for missing attributes.',
    },
    {
      name: 'query-table-records',
      description:
        'Query a DynamoDB table or index by partition key with optional filters and return the matching items.',
      content:
        '# Query Table Records\n\nFetch a set of related items from DynamoDB using a query.\n\n## Steps\n1. Determine the table or secondary index and the partition key value to query.\n2. Add a sort-key condition or filter expression if needed to narrow results.\n3. Run the query and collect the items, paginating if there are more.\n\n## Output\nThe matching items and a count. Note if results were truncated by a limit or pagination boundary.',
    },
    {
      name: 'upsert-item',
      description: 'Create or update a DynamoDB item, setting attributes from provided values.',
      content:
        '# Upsert Item\n\nWrite a record into a DynamoDB table.\n\n## Steps\n1. Build the item with its primary key and the attributes to set.\n2. Put the item, or use an update expression to modify only specific attributes.\n3. Confirm the write succeeded.\n\n## Output\nConfirm the item key written and which attributes were set or updated.',
    },
  ],
} as const satisfies BlockMeta

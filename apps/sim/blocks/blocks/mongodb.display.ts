import { MongoDBIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const MongoDBBlockDisplay = {
  type: 'mongodb',
  name: 'MongoDB',
  description: 'Connect to MongoDB database',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: MongoDBIcon,
  longDescription:
    'Integrate MongoDB into the workflow. Can find, insert, update, delete, and aggregate data.',
  docsLink: 'https://docs.sim.ai/integrations/mongodb',
  integrationType: IntegrationType.Databases,
} satisfies BlockDisplay

export const MongoDBBlockMeta = {
  tags: ['data-warehouse', 'cloud'],
  url: 'https://www.mongodb.com',
  templates: [
    {
      icon: MongoDBIcon,
      title: 'MongoDB to data lake export',
      prompt:
        'Build a scheduled workflow that runs each night, exports MongoDB collections to S3 with partitioned Parquet files, and registers them in an Athena-queryable catalog.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'sync'],
      alsoIntegrations: ['s3'],
    },
    {
      icon: MongoDBIcon,
      title: 'MongoDB index health monitor',
      prompt:
        'Create a scheduled workflow that scans MongoDB collections for slow queries and missing indexes, writes a remediation table, and opens Linear tickets for the worst offenders.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'devops'],
      alsoIntegrations: ['linear'],
    },
    {
      icon: MongoDBIcon,
      title: 'MongoDB to vector enrichment',
      prompt:
        'Build a scheduled workflow that polls a MongoDB collection for new documents, generates OpenAI embeddings, and upserts them into Pinecone with the source document ID for retrieval.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'sync'],
      alsoIntegrations: ['pinecone', 'openai'],
    },
    {
      icon: MongoDBIcon,
      title: 'MongoDB user-event triage',
      prompt:
        'Create a scheduled workflow that polls a MongoDB user-events collection for new records, classifies events as engagement or risk signals, and writes high-priority items to a triage table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['product', 'analysis'],
    },
    {
      icon: MongoDBIcon,
      title: 'MongoDB orphaned-doc cleaner',
      prompt:
        'Build a scheduled workflow that runs weekly, finds orphaned references in MongoDB, dry-runs the cleanup plan, posts to Slack for approval, and executes once approved.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: MongoDBIcon,
      title: 'MongoDB query digest',
      prompt:
        'Create a scheduled daily workflow that aggregates MongoDB query telemetry from the profiler, identifies the top-cost queries, and posts a Slack engineering digest.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'devops'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: MongoDBIcon,
      title: 'MongoDB + Tinybird feeder',
      prompt:
        'Build a scheduled workflow that batches new MongoDB records into a Tinybird pipe on a short interval, exposes the data to downstream apps, and writes the load metrics to a table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'sync'],
      alsoIntegrations: ['tinybird'],
    },
  ],
  skills: [
    {
      name: 'find-documents',
      description: 'Query a MongoDB collection with a filter and return the matching documents.',
      content:
        '# Find Documents\n\nRetrieve documents from a MongoDB collection that match a filter.\n\n## Steps\n1. If the collection shape is unknown, run Introspect Database first to learn the fields.\n2. Build a MongoDB filter document for the requested condition, using operators like $gte, $in, and $regex as needed.\n3. Run Find Documents against the target collection with the filter, plus projection and limit when appropriate.\n\n## Output\nReturn the matching documents. State the filter used and the number of results. Suggest an index if a scan looks slow.',
    },
    {
      name: 'aggregate-report',
      description: 'Run a MongoDB aggregation pipeline to group and summarize collection data.',
      content:
        '# Aggregate Report\n\nProduce a summary from a MongoDB collection using an aggregation pipeline.\n\n## Steps\n1. Introspect the collection to confirm the fields to group and measure on.\n2. Compose a pipeline with stages such as $match, $group, $sort, and $limit to compute the requested metric.\n3. Run the Aggregate Pipeline operation and read back the grouped results.\n\n## Output\nA compact table of the grouped metrics. Include the pipeline used so the query can be rerun.',
    },
    {
      name: 'upsert-document',
      description: 'Insert a new MongoDB document or update an existing one matched by a key.',
      content:
        '# Upsert Document\n\nWrite a document to MongoDB, creating it or updating the existing match.\n\n## Steps\n1. Determine the key field that identifies the record uniquely.\n2. Run Find Documents on that key to see whether a record already exists.\n3. If it exists, run Update Documents with the new values; otherwise run Insert Documents.\n\n## Output\nReport whether a document was inserted or updated and echo the key value. Confirm the affected count.',
    },
  ],
} as const satisfies BlockMeta

import { QdrantIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const QdrantBlockDisplay = {
  type: 'qdrant',
  name: 'Qdrant',
  description: 'Use Qdrant vector database',
  category: 'tools',
  bgColor: '#1A223F',
  icon: QdrantIcon,
  longDescription: 'Integrate Qdrant into the workflow. Can upsert, search, and fetch points.',
  docsLink: 'https://qdrant.tech/documentation/',
  integrationType: IntegrationType.Databases,
} satisfies BlockDisplay

export const QdrantBlockMeta = {
  tags: ['vector-search', 'knowledge-base'],
  url: 'https://qdrant.tech',
  templates: [
    {
      icon: QdrantIcon,
      title: 'Qdrant document ingestion',
      prompt:
        'Build a workflow that watches a Google Drive folder for new docs, chunks each, generates embeddings, and upserts the vectors into a Qdrant collection with rich metadata.',
      modules: ['files', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'sync'],
      alsoIntegrations: ['google_drive', 'openai'],
    },
    {
      icon: QdrantIcon,
      title: 'Qdrant retrieval agent',
      prompt:
        'Create an agent that performs hybrid search against a Qdrant collection — semantic + filter conditions — and answers user questions with the matched documents cited.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['research', 'enterprise'],
    },
    {
      icon: QdrantIcon,
      title: 'Qdrant payload schema migrator',
      prompt:
        'Build a workflow that scans a Qdrant collection, migrates payload schema to a new version with backfilled fields, and writes the migration plan and outcome to an audit table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'automation'],
    },
    {
      icon: QdrantIcon,
      title: 'Qdrant + knowledge base sync',
      prompt:
        'Create a workflow that mirrors a Sim knowledge base into a Qdrant collection so downstream applications outside Sim can perform retrieval against the same vectors.',
      modules: ['knowledge-base', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'sync'],
    },
    {
      icon: QdrantIcon,
      title: 'Qdrant snapshot manager',
      prompt:
        'Build a scheduled workflow that takes a Qdrant collection snapshot each night, uploads it to S3 with retention rotation, and writes the snapshot manifest to a tracking table.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'enterprise'],
      alsoIntegrations: ['s3'],
    },
    {
      icon: QdrantIcon,
      title: 'Qdrant abandoned-document detector',
      prompt:
        'Create a workflow that scans a Qdrant collection for vectors whose source document no longer exists, deletes the orphans, and writes a hygiene report each week.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'automation'],
    },
    {
      icon: QdrantIcon,
      title: 'Qdrant support-answer retriever',
      prompt:
        'Build a workflow that embeds each new Zendesk ticket with OpenAI, runs a filtered Qdrant search scoped to the customer’s product, and drafts a cited reply from the closest matching resolved tickets for the agent to approve.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['support', 'vector-search', 'automation'],
      alsoIntegrations: ['openai', 'zendesk'],
    },
  ],
  skills: [
    {
      name: 'upsert-points',
      description: 'Insert or update vector points with payload metadata into a Qdrant collection.',
      content:
        '# Upsert Points\n\nLoad vectors into a Qdrant collection.\n\n## Steps\n1. Use the Upsert operation with the Qdrant URL, Collection name, and API Key.\n2. Provide Points as a JSON array, each with an id, a vector matching the collection dimension, and an optional payload of metadata for later filtering.\n3. Confirm the upserted count from the response.\n\n## Output\nReport how many points were upserted into which collection and surface any payload validation issues.',
    },
    {
      name: 'search-vectors',
      description: 'Run a vector similarity search in Qdrant with optional payload filters.',
      content:
        '# Search Vectors\n\nFind the nearest points to a query vector.\n\n## Steps\n1. Use the Search operation with the Qdrant URL, Collection, and the Query Vector.\n2. Set the Limit for how many matches to return and choose what Return Data you need (payload only, vector only, both, or none).\n3. Optionally pass a Filter JSON object using must, should, or must_not conditions to scope the search by payload fields.\n\n## Output\nThe top matches with their scores and requested payload or vector data, ordered by similarity.',
    },
    {
      name: 'fetch-points-by-id',
      description: 'Retrieve specific Qdrant points and their payloads by ID.',
      content:
        '# Fetch Points By ID\n\nLook up known points directly.\n\n## Steps\n1. Use the Fetch operation with the Qdrant URL, Collection, and API Key.\n2. Provide the IDs as a JSON array of the points to retrieve.\n3. Choose the Return Data option to control whether payloads and vectors are included.\n\n## Output\nThe requested points with their payloads (and vectors if requested), plus a note on any IDs that were not found.',
    },
  ],
} as const satisfies BlockMeta

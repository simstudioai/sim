import { PineconeIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const PineconeBlockDisplay = {
  type: 'pinecone',
  name: 'Pinecone',
  description: 'Use Pinecone vector database',
  category: 'tools',
  bgColor: '#0D1117',
  icon: PineconeIcon,
  longDescription:
    'Integrate Pinecone into the workflow. Can generate embeddings, upsert text, search with text, fetch vectors, and search with vectors.',
  docsLink: 'https://docs.sim.ai/integrations/pinecone',
  integrationType: IntegrationType.Databases,
} satisfies BlockDisplay

export const PineconeBlockMeta = {
  tags: ['vector-search', 'knowledge-base'],
  url: 'https://www.pinecone.io',
  templates: [
    {
      icon: PineconeIcon,
      title: 'Pinecone reindex pipeline',
      prompt:
        'Build a scheduled workflow that regenerates embeddings with OpenAI for new or changed source documents and upserts the vectors into a Pinecone index so retrieval stays current.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'sync'],
      alsoIntegrations: ['openai'],
    },
    {
      icon: PineconeIcon,
      title: 'Pinecone semantic search agent',
      prompt:
        'Create an agent that takes a natural-language query, embeds it with OpenAI, retrieves top-k matches from Pinecone, and answers with cited passages plus a confidence score.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['research', 'enterprise'],
      alsoIntegrations: ['openai'],
    },
    {
      icon: PineconeIcon,
      title: 'Pinecone retrieval-quality monitor',
      prompt:
        'Build a scheduled weekly workflow that runs a fixed set of benchmark queries against a Pinecone index, records top-k similarity scores per namespace to a table, and pings Slack when retrieval quality regresses.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: PineconeIcon,
      title: 'Pinecone duplicate detector',
      prompt:
        'Create a workflow that reads a table of candidate records, embeds each with OpenAI, searches a Pinecone index for matches above a similarity threshold, and writes the near-duplicates to a cleanup queue.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'analysis'],
      alsoIntegrations: ['openai'],
    },
    {
      icon: PineconeIcon,
      title: 'Pinecone tenant isolation auditor',
      prompt:
        'Build a workflow that verifies Pinecone namespace isolation by sampling cross-namespace queries, ensuring no leakage, and writing a compliance audit report each week.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'enterprise'],
    },
    {
      icon: PineconeIcon,
      title: 'Pinecone FAQ deflection bot',
      prompt:
        'Create a workflow that embeds an incoming question with OpenAI, searches a Pinecone index of FAQ entries for the closest match, and returns the answer when similarity is high or escalates when it is not.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['support', 'automation'],
      alsoIntegrations: ['openai'],
    },
    {
      icon: PineconeIcon,
      title: 'Pinecone support knowledge retriever',
      prompt:
        'Build a workflow that fetches each new Zendesk ticket, embeds the question with OpenAI, queries a Pinecone index of resolved tickets and docs, and drafts a suggested reply citing the most relevant matches for the agent to approve.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['support', 'vector-search', 'automation'],
      alsoIntegrations: ['openai', 'zendesk'],
    },
  ],
  skills: [
    {
      name: 'upsert-text-records',
      description:
        'Embed and upsert text records into a Pinecone namespace using integrated embeddings.',
      content:
        '# Upsert Text Records\n\nLoad documents into a Pinecone index for retrieval.\n\n## Steps\n1. Use the Upsert Text operation and provide the Index Host and target Namespace.\n2. Pass newline-delimited JSON Records, each with a unique _id, a text or chunk_text field, and any metadata fields such as category for later filtering.\n3. Keep chunks reasonably sized so each record carries one coherent idea.\n4. Confirm the upsert status from the response.\n\n## Output\nReport how many records were upserted into which namespace and surface any records that failed validation.',
    },
    {
      name: 'semantic-search',
      description:
        'Run a text query against a Pinecone index with metadata filtering and optional reranking.',
      content:
        '# Semantic Search\n\nRetrieve the most relevant records for a query.\n\n## Steps\n1. Use the Search With Text operation with the Index Host, Namespace, and a natural-language Search Query.\n2. Set Top K for how many matches to return and list the Fields to Return.\n3. Optionally apply a metadata Filter (operators like $eq, $in, $gte) to scope the search, and pass Rerank Options to reorder by a cross-encoder for higher precision.\n\n## Output\nThe top matches with their scores, returned fields, and IDs, ordered by relevance after any reranking.',
    },
    {
      name: 'generate-embeddings',
      description:
        'Generate vector embeddings for a set of texts with a Pinecone-hosted embedding model.',
      content:
        '# Generate Embeddings\n\nTurn text into vectors for storage or comparison.\n\n## Steps\n1. Use the Generate Embeddings operation and choose a model such as multilingual-e5-large or llama-text-embed-v2.\n2. Provide the Text Inputs as a JSON array of objects each with a text field.\n3. Use the returned vectors for downstream upserts or similarity work.\n\n## Output\nThe embedding vector per input, the model used, and the usage statistics for cost tracking.',
    },
    {
      name: 'fetch-vectors-by-id',
      description: 'Fetch specific vectors and their metadata from a Pinecone namespace by ID.',
      content:
        '# Fetch Vectors By ID\n\nLook up known records directly.\n\n## Steps\n1. Use the Fetch Vectors operation with the Index Host and Namespace.\n2. Provide the Vector IDs as a JSON array of the records to retrieve.\n3. Inspect the returned values and metadata to confirm content or debug retrieval.\n\n## Output\nThe requested records with their stored metadata, and a note listing any IDs that were not found.',
    },
  ],
} as const satisfies BlockMeta

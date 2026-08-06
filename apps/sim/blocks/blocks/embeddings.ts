import { EmbeddingsIcon } from '@/components/icons'
/**
 * Imported from the catalog module directly rather than the `@/lib/embeddings`
 * barrel: the barrel re-exports the client, which reaches BYOK key lookup and
 * `@sim/db`. Block configs are bundled for the browser, so only the pure
 * catalog data may cross this boundary.
 *
 * The sub-blocks below spell out models, task types, and dimensions as literals
 * rather than deriving them from the catalog. `scripts/generate-docs.ts` parses
 * this file as source text, so anything computed is invisible to the docs page
 * and to `integrations.json` (which would report zero operations). The
 * `embeddings.test.ts` drift test asserts the literals still match the catalog.
 */
import { EMBEDDING_MODELS } from '@/lib/embeddings/catalog'
import type { EmbeddingCatalogProvider, EmbeddingTaskType } from '@/lib/embeddings/types'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { EmbeddingsResponse } from '@/tools/embeddings/types'

const DEFAULT_MODEL_BY_PROVIDER: Record<EmbeddingCatalogProvider, string> = {
  openai: 'text-embedding-3-small',
  gemini: 'gemini-embedding-001',
  cohere: 'embed-v4.0',
  mistral: 'mistral-embed',
}

const TOOL_ID_BY_PROVIDER: Record<EmbeddingCatalogProvider, string> = {
  openai: 'embeddings_openai',
  gemini: 'embeddings_gemini',
  cohere: 'embeddings_cohere',
  mistral: 'embeddings_mistral',
}

export const EmbeddingsBlock: BlockConfig<EmbeddingsResponse> = {
  type: 'embeddings',
  name: 'Embeddings',
  description: 'Generate embeddings',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Turn text into embedding vectors for semantic search, clustering, and similarity. Supports OpenAI, Google Gemini, Cohere, and Mistral embedding models.',
  category: 'tools',
  integrationType: IntegrationType.AI,
  docsLink: 'https://docs.sim.ai/integrations/embeddings',
  bgColor: '#7B4DFF',
  icon: EmbeddingsIcon,
  subBlocks: [
    {
      id: 'input',
      title: 'Input Text',
      type: 'long-input',
      placeholder: 'Enter text to generate embeddings for',
      required: true,
    },
    {
      id: 'provider',
      title: 'Provider',
      type: 'dropdown',
      options: [
        { label: 'OpenAI', id: 'openai' },
        { label: 'Google Gemini', id: 'gemini' },
        { label: 'Cohere', id: 'cohere' },
        { label: 'Mistral', id: 'mistral' },
      ],
      commandSearchable: true,
      value: () => 'openai',
    },
    {
      id: 'model',
      title: 'Model',
      type: 'dropdown',
      options: [
        { label: 'text-embedding-3-small', id: 'text-embedding-3-small' },
        { label: 'text-embedding-3-large', id: 'text-embedding-3-large' },
        { label: 'text-embedding-ada-002', id: 'text-embedding-ada-002' },
      ],
      value: () => 'text-embedding-3-small',
      condition: { field: 'provider', value: 'openai' },
      dependsOn: ['provider'],
    },
    {
      id: 'model',
      title: 'Model',
      type: 'dropdown',
      options: [{ label: 'gemini-embedding-001', id: 'gemini-embedding-001' }],
      value: () => 'gemini-embedding-001',
      condition: { field: 'provider', value: 'gemini' },
      dependsOn: ['provider'],
    },
    {
      id: 'model',
      title: 'Model',
      type: 'dropdown',
      options: [{ label: 'embed-v4.0', id: 'embed-v4.0' }],
      value: () => 'embed-v4.0',
      condition: { field: 'provider', value: 'cohere' },
      dependsOn: ['provider'],
    },
    {
      id: 'model',
      title: 'Model',
      type: 'dropdown',
      options: [
        { label: 'mistral-embed', id: 'mistral-embed' },
        { label: 'codestral-embed', id: 'codestral-embed' },
      ],
      value: () => 'mistral-embed',
      condition: { field: 'provider', value: 'mistral' },
      dependsOn: ['provider'],
    },
    {
      id: 'taskType',
      title: 'Task Type',
      type: 'dropdown',
      options: [
        { label: 'Document', id: 'document' },
        { label: 'Query', id: 'query' },
        { label: 'Semantic Similarity', id: 'similarity' },
        { label: 'Classification', id: 'classification' },
        { label: 'Clustering', id: 'clustering' },
      ],
      value: () => 'document',
      condition: {
        field: 'provider',
        value: 'gemini',
        and: { field: 'model', value: 'gemini-embedding-001' },
      },
      dependsOn: ['provider', 'model'],
    },
    {
      id: 'taskType',
      title: 'Task Type',
      type: 'dropdown',
      options: [
        { label: 'Document', id: 'document' },
        { label: 'Query', id: 'query' },
        { label: 'Classification', id: 'classification' },
        { label: 'Clustering', id: 'clustering' },
      ],
      value: () => 'document',
      condition: {
        field: 'provider',
        value: 'cohere',
        and: { field: 'model', value: 'embed-v4.0' },
      },
      dependsOn: ['provider', 'model'],
    },
    {
      id: 'dimensions',
      title: 'Dimensions',
      type: 'dropdown',
      options: [
        { label: '1536 (default)', id: '1536' },
        { label: '1024', id: '1024' },
        { label: '768', id: '768' },
        { label: '512', id: '512' },
        { label: '256', id: '256' },
      ],
      value: () => '1536',
      condition: {
        field: 'provider',
        value: 'openai',
        and: { field: 'model', value: 'text-embedding-3-small' },
      },
      dependsOn: ['provider', 'model'],
    },
    {
      id: 'dimensions',
      title: 'Dimensions',
      type: 'dropdown',
      options: [
        { label: '3072 (default)', id: '3072' },
        { label: '1536', id: '1536' },
        { label: '1024', id: '1024' },
        { label: '768', id: '768' },
        { label: '512', id: '512' },
        { label: '256', id: '256' },
      ],
      value: () => '3072',
      condition: {
        field: 'provider',
        value: 'openai',
        and: { field: 'model', value: 'text-embedding-3-large' },
      },
      dependsOn: ['provider', 'model'],
    },
    {
      id: 'dimensions',
      title: 'Dimensions',
      type: 'dropdown',
      options: [
        { label: '3072 (default)', id: '3072' },
        { label: '1536', id: '1536' },
        { label: '768', id: '768' },
      ],
      value: () => '3072',
      condition: {
        field: 'provider',
        value: 'gemini',
        and: { field: 'model', value: 'gemini-embedding-001' },
      },
      dependsOn: ['provider', 'model'],
    },
    {
      id: 'dimensions',
      title: 'Dimensions',
      type: 'dropdown',
      options: [
        { label: '1536 (default)', id: '1536' },
        { label: '1024', id: '1024' },
        { label: '512', id: '512' },
        { label: '256', id: '256' },
      ],
      value: () => '1536',
      condition: {
        field: 'provider',
        value: 'cohere',
        and: { field: 'model', value: 'embed-v4.0' },
      },
      dependsOn: ['provider', 'model'],
    },
    {
      id: 'dimensions',
      title: 'Dimensions',
      type: 'dropdown',
      options: [
        { label: '1536 (default)', id: '1536' },
        { label: '1024', id: '1024' },
        { label: '512', id: '512' },
        { label: '256', id: '256' },
      ],
      value: () => '1536',
      condition: {
        field: 'provider',
        value: 'mistral',
        and: { field: 'model', value: 'codestral-embed' },
      },
      dependsOn: ['provider', 'model'],
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your provider API key',
      password: true,
      required: true,
      connectionDroppable: false,
      hideWhenHosted: true,
      condition: { field: 'provider', value: ['openai', 'gemini', 'cohere'] },
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your provider API key',
      password: true,
      required: true,
      connectionDroppable: false,
      condition: { field: 'provider', value: ['openai', 'gemini', 'cohere'], not: true },
    },
  ],
  tools: {
    access: ['embeddings_openai', 'embeddings_gemini', 'embeddings_cohere', 'embeddings_mistral'],
    config: {
      /**
       * Runs at serialization, before variable resolution, so this only ever
       * does plain lookups — never coercion, which would destroy dynamic
       * `<Block.output>` references.
       */
      tool: (params) => {
        const provider = params.provider as EmbeddingCatalogProvider
        return TOOL_ID_BY_PROVIDER[provider] ?? TOOL_ID_BY_PROVIDER.openai
      },
      /**
       * Every per-provider dropdown shares one subblock id (`model`,
       * `taskType`, `dimensions`) and nothing clears a stored value when its
       * `dependsOn` fields change, so a choice made for one provider or model
       * outlives a switch away from it.
       *
       * Each stale field is therefore rewritten to an explicit `undefined`
       * rather than omitted. The generic handler merges this result over the
       * original inputs (`{ ...inputs, ...transformedParams }`), so an omitted
       * key leaves the stale value untouched — only an explicit `undefined`
       * overrides it.
       */
      params: (params) => {
        const provider = (params.provider as EmbeddingCatalogProvider) || 'openai'
        if (!params.input) {
          throw new Error('Input text is required')
        }

        /** A model saved under a previous provider must not survive the switch. */
        const savedModel = params.model as string | undefined
        const model =
          savedModel && EMBEDDING_MODELS[savedModel]?.provider === provider
            ? savedModel
            : DEFAULT_MODEL_BY_PROVIDER[provider]

        const info = EMBEDDING_MODELS[model]
        const requested =
          params.dimensions !== undefined && params.dimensions !== ''
            ? Number(params.dimensions)
            : undefined
        const dimensions =
          requested !== undefined &&
          !Number.isNaN(requested) &&
          info?.supportedDimensions?.includes(requested)
            ? requested
            : undefined
        const taskType =
          params.taskType &&
          info?.supportedTaskTypes?.includes(params.taskType as EmbeddingTaskType)
            ? (params.taskType as EmbeddingTaskType)
            : undefined

        return {
          apiKey: params.apiKey,
          input: params.input,
          model,
          taskType,
          dimensions,
        }
      },
    },
  },
  inputs: {
    input: { type: 'string', description: 'Text to embed, or an array of texts' },
    provider: { type: 'string', description: 'Embedding provider' },
    model: { type: 'string', description: 'Embedding model' },
    taskType: { type: 'string', description: 'What the embedding will be used for' },
    dimensions: { type: 'number', description: 'Output vector dimensions' },
    apiKey: { type: 'string', description: 'Provider API key' },
  },
  outputs: {
    embeddings: { type: 'json', description: 'Generated embeddings' },
    model: { type: 'string', description: 'Model used' },
    provider: { type: 'string', description: 'Provider used' },
    dimensions: { type: 'number', description: 'Dimensionality of each vector' },
    usage: { type: 'json', description: 'Token usage' },
  },
}

export { DEFAULT_MODEL_BY_PROVIDER, TOOL_ID_BY_PROVIDER }

export const EmbeddingsBlockMeta = {
  tags: ['llm', 'vector-search'],
  url: 'https://docs.sim.ai/integrations/embeddings',
  templates: [
    {
      icon: EmbeddingsIcon,
      title: 'Document embedding pipeline',
      prompt:
        'Build a workflow that watches a files folder, chunks each new document, generates embeddings, and upserts vectors into Pinecone with rich metadata for retrieval.',
      modules: ['files', 'knowledge-base', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['automation', 'sync'],
      alsoIntegrations: ['pinecone'],
    },
    {
      icon: EmbeddingsIcon,
      title: 'Knowledge base re-embedder',
      prompt:
        'Create a scheduled workflow that finds documents whose embeddings are stale, regenerates them, and re-upserts the vectors into Pinecone so retrieval stays current.',
      modules: ['scheduled', 'knowledge-base', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['automation', 'sync', 'vector-search'],
      alsoIntegrations: ['pinecone'],
    },
    {
      icon: EmbeddingsIcon,
      title: 'Semantic duplicate detector',
      prompt:
        'Build a workflow that reads new rows from a table, generates an embedding for each, compares them against existing rows by cosine similarity, and flags near-duplicates in an evaluation table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'analysis', 'vector-search'],
    },
    {
      icon: EmbeddingsIcon,
      title: 'Product catalog semantic search',
      prompt:
        'Create a workflow that embeds each product description from a table, upserts the vectors into Pinecone, and lets an incoming query return the closest matching products by similarity.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'vector-search'],
      alsoIntegrations: ['pinecone'],
    },
    {
      icon: EmbeddingsIcon,
      title: 'Semantic ticket deduplication',
      prompt:
        'Build a workflow that embeds each new support ticket, searches a Pinecone index of past tickets for near-duplicates, and links the new ticket to the matching thread instead of opening a fresh one.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['support', 'automation', 'vector-search'],
      alsoIntegrations: ['pinecone'],
    },
    {
      icon: EmbeddingsIcon,
      title: 'FAQ semantic router',
      prompt:
        'Create a workflow that embeds an incoming question, compares it against embedded FAQ entries to find the closest match, and returns the canned answer when similarity is high or escalates to an agent when it is not.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['support', 'automation', 'vector-search'],
    },
    {
      icon: EmbeddingsIcon,
      title: 'Embedding-based content clustering',
      prompt:
        'Build a scheduled workflow that pulls recent feedback from a table, generates embeddings for each entry, clusters them by semantic similarity, and writes the themed groups with representative quotes back to a summary table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['analysis', 'automation', 'vector-search'],
    },
  ],
  skills: [
    {
      name: 'embed-text',
      description:
        'Generate an embedding vector for a piece of text to use in semantic search or similarity.',
      content:
        '# Embed Text\n\nConvert text into an embedding vector.\n\n## Steps\n1. Take the input text. If it is long, ensure it fits the model context; otherwise chunk it first.\n2. Choose a provider and model — text-embedding-3-small for cost-efficient general use, gemini-embedding-001 for the highest retrieval quality, embed-v4.0 for multilingual work, or codestral-embed for code. Keep the model consistent with any existing vectors it will be compared against.\n3. Set the task type to Query or Document when the model supports it, so the vector is conditioned for how it will be used.\n4. Generate the embedding.\n\n## Output\nReturn the embedding vector, the provider and model used, the dimensionality, and token usage. Vectors are only comparable when they come from the same model at the same dimensionality.',
    },
    {
      name: 'embed-documents-for-retrieval',
      description:
        'Chunk and embed a set of documents so they can be upserted into a vector store for retrieval.',
      content:
        '# Embed Documents for Retrieval\n\nPrepare documents for semantic retrieval by chunking and embedding them.\n\n## Steps\n1. Split each document into reasonably sized chunks with light overlap so context is preserved.\n2. Embed each chunk with a single consistent model, using the Document task type where the model supports it.\n3. Pair each vector with its source metadata (document ID, chunk index, title) ready for upsert into the vector store.\n\n## Output\nReturn the embeddings with their associated metadata, the model used, and the dimensionality. Report how many chunks were produced and flag any chunk that failed to embed.',
    },
    {
      name: 'find-semantic-duplicates',
      description:
        'Embed items and compare vectors by cosine similarity to flag near-duplicate content.',
      content:
        '# Find Semantic Duplicates\n\nDetect items that mean the same thing even when worded differently.\n\n## Steps\n1. Embed each candidate item with the same model and dimensionality used for the existing set.\n2. Compare each new vector against existing vectors using cosine similarity.\n3. Flag pairs above a similarity threshold (e.g. 0.9) as likely duplicates; treat lower scores as distinct.\n\n## Output\nReturn the flagged duplicate pairs with their similarity scores, sorted highest first, so they can be merged or deduplicated.',
    },
  ],
} as const satisfies BlockMeta

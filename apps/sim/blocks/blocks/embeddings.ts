import { EmbeddingsIcon } from '@/components/icons'
/**
 * Imported from the catalog module directly rather than the `@/lib/embeddings`
 * barrel: the barrel re-exports the client, which reaches BYOK key lookup and
 * `@sim/db`. Block configs are bundled for the browser, so only the pure
 * catalog data may cross this boundary.
 */
import {
  DEFAULT_MODEL_BY_PROVIDER,
  EMBEDDING_CATALOG_PROVIDERS,
  EMBEDDING_MODELS,
  getModelsForProvider,
} from '@/lib/embeddings/catalog'
import {
  DEFAULT_OPENROUTER_EMBEDDING_MODEL,
  normalizeOpenRouterEmbeddingModelId,
} from '@/lib/embeddings/openrouter-models'
import type { EmbeddingTaskType } from '@/lib/embeddings/types'
import type { BlockConfig, BlockMeta, SubBlockConfig } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { EmbeddingsResponse } from '@/tools/embeddings/types'

export const EMBEDDING_BLOCK_PROVIDERS = [...EMBEDDING_CATALOG_PROVIDERS, 'openrouter'] as const

type EmbeddingBlockProvider = (typeof EMBEDDING_BLOCK_PROVIDERS)[number]

const TOOL_ID_BY_PROVIDER: Record<EmbeddingBlockProvider, string> = {
  openai: 'embeddings_openai',
  openrouter: 'embeddings_openrouter',
  gemini: 'embeddings_gemini',
  cohere: 'embeddings_cohere',
  mistral: 'embeddings_mistral',
}

const PROVIDER_LABELS: Record<EmbeddingBlockProvider, string> = {
  openai: 'OpenAI',
  openrouter: 'OpenRouter',
  gemini: 'Google Gemini',
  cohere: 'Cohere',
  mistral: 'Mistral',
}

const TASK_TYPE_LABELS: Record<EmbeddingTaskType, string> = {
  document: 'Document',
  query: 'Query',
  similarity: 'Semantic Similarity',
  classification: 'Classification',
  clustering: 'Clustering',
}

/**
 * Dropdowns are derived from the catalog rather than hand-copied, so adding a
 * catalog model cannot leave this block stale. Every variant shares one
 * sub-block id, so each is scoped by a `condition` naming the provider.
 */
const MODEL_SUB_BLOCKS: SubBlockConfig[] = EMBEDDING_CATALOG_PROVIDERS.map((provider) => {
  return {
    id: 'model',
    title: 'Model',
    type: 'dropdown',
    options: getModelsForProvider(provider).map((id) => ({
      label: EMBEDDING_MODELS[id].label,
      id,
    })),
    value: () => DEFAULT_MODEL_BY_PROVIDER[provider],
    condition: { field: 'provider', value: provider },
    dependsOn: ['provider'],
  }
})

MODEL_SUB_BLOCKS.push({
  id: 'model',
  title: 'Model',
  type: 'combobox',
  selectorKey: 'providers.openrouterEmbeddingModels',
  value: () => DEFAULT_OPENROUTER_EMBEDDING_MODEL,
  condition: { field: 'provider', value: 'openrouter' },
  dependsOn: ['provider'],
})

/**
 * Task-type and dimension dropdowns, which are per-model rather than
 * per-provider: the `condition` names both, and a model contributes a dropdown
 * only for the capabilities the catalog says it has.
 */
const CAPABILITY_SUB_BLOCKS: SubBlockConfig[] = Object.entries(EMBEDDING_MODELS).flatMap(
  ([model, info]) => {
    return [info.provider].flatMap((provider) => {
      const scope = { field: 'provider', value: provider, and: { field: 'model', value: model } }
      const subBlocks: SubBlockConfig[] = []

      if (info.supportedTaskTypes) {
        subBlocks.push({
          id: 'taskType',
          title: 'Task Type',
          type: 'dropdown',
          options: info.supportedTaskTypes.map((task) => ({
            label: TASK_TYPE_LABELS[task],
            id: task,
          })),
          value: () => 'document',
          condition: scope,
          dependsOn: ['provider', 'model'],
        })
      }

      if (info.supportedDimensions) {
        subBlocks.push({
          id: 'dimensions',
          title: 'Dimensions',
          type: 'dropdown',
          options: info.supportedDimensions.map((size) => ({
            label: size === info.nativeDimensions ? `${size} (default)` : String(size),
            id: String(size),
          })),
          value: () => String(info.nativeDimensions),
          condition: scope,
          dependsOn: ['provider', 'model'],
        })
      }

      return subBlocks
    })
  }
)

export const EmbeddingsBlock: BlockConfig<EmbeddingsResponse> = {
  type: 'embeddings',
  name: 'Embeddings',
  description: 'Generate embeddings',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Turn text into embedding vectors for semantic search, clustering, and similarity. Supports OpenAI, OpenRouter, Google Gemini, Cohere, and Mistral embedding models.',
  category: 'tools',
  integrationType: IntegrationType.AI,
  docsLink: 'https://docs.sim.ai/integrations/embeddings',
  bgColor: '#7B4DFF',
  icon: EmbeddingsIcon,
  canvasPresentation: {
    defaultTitle: 'Embeddings',
    sentences: {
      /* Anchored on `input`: it is the one required field every provider shows.
         `model` is scoped by a per-provider `condition`, so it carries the
         clause but cannot be what keeps the sentence on the card. */
      default: [
        { text: 'Embed', field: 'input', core: true },
        { text: 'with', field: 'model' },
      ],
    },
  },
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
      options: EMBEDDING_BLOCK_PROVIDERS.map((provider) => ({
        label: PROVIDER_LABELS[provider],
        id: provider,
      })),
      commandSearchable: true,
      value: () => 'openai',
    },
    ...MODEL_SUB_BLOCKS,
    ...CAPABILITY_SUB_BLOCKS,
    /**
     * Sim stocks a hosted key for each catalog provider, so none of those
     * fields needs the user to supply one on hosted Sim. OpenRouter is always
     * explicit BYOK for this block.
     */
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your provider API key',
      password: true,
      required: true,
      condition: { field: 'provider', value: 'openrouter', not: true },
      connectionDroppable: false,
      hideWhenHosted: true,
    },
    {
      id: 'openRouterApiKey',
      title: 'OpenRouter API Key',
      type: 'short-input',
      placeholder: 'Enter your OpenRouter API key',
      password: true,
      required: true,
      condition: { field: 'provider', value: 'openrouter' },
      connectionDroppable: false,
    },
  ],
  tools: {
    access: [
      'embeddings_openai',
      'embeddings_openrouter',
      'embeddings_gemini',
      'embeddings_cohere',
      'embeddings_mistral',
    ],
    config: {
      /**
       * Runs at serialization, before variable resolution, so this only ever
       * does plain lookups — never coercion, which would destroy dynamic
       * `<Block.output>` references.
       */
      tool: (params) => {
        const provider = (params.provider as EmbeddingBlockProvider | undefined) ?? 'openai'
        const toolId = TOOL_ID_BY_PROVIDER[provider]
        if (!toolId) throw new Error(`Unsupported embedding provider: ${String(params.provider)}`)
        return toolId
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
        const provider = (params.provider as EmbeddingBlockProvider) || 'openai'
        if (!params.input) {
          throw new Error('Input text is required')
        }

        if (provider === 'openrouter') {
          if (typeof params.openRouterApiKey !== 'string' || !params.openRouterApiKey.trim()) {
            throw new Error('OpenRouter API key is required')
          }
          const savedModel =
            typeof params.model === 'string' && params.model ? params.model : undefined
          const savedCatalogProvider = savedModel
            ? EMBEDDING_MODELS[savedModel]?.provider
            : undefined
          const model = normalizeOpenRouterEmbeddingModelId(
            savedCatalogProvider && savedCatalogProvider !== 'openai'
              ? DEFAULT_OPENROUTER_EMBEDDING_MODEL
              : (savedModel ?? DEFAULT_OPENROUTER_EMBEDDING_MODEL)
          )
          return {
            apiKey: params.openRouterApiKey,
            input: params.input,
            model,
            taskType: undefined,
            dimensions: undefined,
          }
        }

        const catalogProvider = provider

        /** A model saved under a previous provider must not survive the switch. */
        const savedModel = params.model as string | undefined
        const model =
          savedModel && EMBEDDING_MODELS[savedModel]?.provider === catalogProvider
            ? savedModel
            : DEFAULT_MODEL_BY_PROVIDER[catalogProvider]

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
    openRouterApiKey: {
      type: 'string',
      description: 'OpenRouter API key',
    },
  },
  outputs: {
    embeddings: { type: 'json', description: 'Generated embeddings' },
    model: { type: 'string', description: 'Model used' },
    provider: { type: 'string', description: 'Provider used' },
    dimensions: { type: 'number', description: 'Dimensionality of each vector' },
    usage: { type: 'json', description: 'Token usage' },
  },
}

export { TOOL_ID_BY_PROVIDER }

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

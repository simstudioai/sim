/**
 * Provider-agnostic embedding types shared by the knowledge-base indexing path
 * and the Embeddings block. Provider-specific wire formats are confined to
 * `@/lib/embeddings/providers`.
 */

export type EmbeddingProviderKind = 'openai' | 'azure-openai' | 'gemini' | 'cohere' | 'mistral'

/**
 * Providers a catalog model can belong to. Azure OpenAI is excluded because it
 * is a transport override for OpenAI models rather than a provider users pick:
 * no model is ever catalogued under it, and it resolves its own credentials.
 */
export type EmbeddingCatalogProvider = Exclude<EmbeddingProviderKind, 'azure-openai'>

/** Provider id for `estimateTokenCount` so token counts match the embedding provider's tokenization. */
export type TokenizerProviderId = 'openai' | 'google' | 'cohere' | 'mistral'

/**
 * What the embedding will be used for. Providers that support task-conditioned
 * embeddings map these onto their own enum; providers that do not ignore it.
 */
export type EmbeddingTaskType =
  | 'document'
  | 'query'
  | 'similarity'
  | 'classification'
  | 'clustering'

export interface EmbeddingProviderRequest {
  apiUrl: string
  headers: Record<string, string>
  body: unknown
  /** Extracts vectors from the provider's response, in input order. */
  parse: (json: unknown) => number[][]
  /** Reads the provider's reported prompt-token count, when it reports one. */
  parseTokens?: (json: unknown) => number | undefined
}

export interface BuildEmbeddingRequestOptions {
  inputs: string[]
  taskType: EmbeddingTaskType
  /** Target output dimensions. Undefined means the model's native dimensionality. */
  dimensions?: number
}

export interface EmbeddingProviderAdapter {
  buildRequest: (options: BuildEmbeddingRequestOptions) => EmbeddingProviderRequest
  /** Hard per-request item cap enforced by the provider (e.g. Gemini caps at 100). */
  maxItemsPerRequest?: number
}

export interface EmbeddingAdapterContext {
  /** Model name as the provider expects it on the wire (an Azure deployment name for Azure). */
  modelName: string
  apiKey: string
  /** Model's un-reduced dimensionality, so adapters can detect a Matryoshka reduction. */
  nativeDimensions: number
  /** Azure OpenAI only. */
  endpoint?: string
  /** Azure OpenAI only. */
  apiVersion?: string
}

export type EmbeddingAdapterFactory = (context: EmbeddingAdapterContext) => EmbeddingProviderAdapter

export interface EmbedOptions {
  /** Catalog model id. Defaults to the platform default when omitted. */
  model?: string
  /** Workspace used to look up a BYOK key before falling back to platform keys. */
  workspaceId?: string | null
  taskType?: EmbeddingTaskType
  /** Target output dimensions. Undefined means the model's native dimensionality. */
  dimensions?: number
  /**
   * Caller-supplied key that bypasses BYOK/env/rotating-pool resolution entirely.
   * Used by the Embeddings block when the user pastes their own key.
   */
  apiKey?: string
}

export interface EmbedResult {
  embeddings: number[][]
  totalTokens: number
  /** True when a workspace-owned key was used, meaning Sim does not bill for it. */
  isBYOK: boolean
  /** Model name as sent to the provider. */
  modelName: string
  /** Pricing identifier for use with `getEmbeddingModelPricing` / `calculateCost`. */
  pricingId: string
  /** Dimensionality of the returned vectors. */
  dimensions: number
}

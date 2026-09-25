import { vi } from 'vitest'

const MAX_EMBEDDING_AGGREGATE_RESPONSE_BYTES = 100 * 1024 * 1024
const EMBEDDING_RESPONSE_ENVELOPE_RESERVE_BYTES = 64 * 1024
const EMBEDDING_RESPONSE_BYTES_PER_DIMENSION = 32
const EMBEDDING_RESPONSE_BYTES_PER_ITEM = 128
const OLLAMA_EMBEDDING_MODEL_PREFIX = 'ollama/'

/**
 * Stand-in for the real `EmbeddingOutputLimitError` (real name, message and constructor args).
 */
export class MockEmbeddingOutputLimitError extends Error {
  constructor(itemCount: number, dimensions: number, estimatedBytes: number) {
    super(
      `Embedding output for ${itemCount} inputs at ${dimensions} dimensions is estimated at ${estimatedBytes} bytes, exceeding the safe aggregate limit of ${MAX_EMBEDDING_AGGREGATE_RESPONSE_BYTES} bytes`
    )
    this.name = 'EmbeddingOutputLimitError'
  }
}

interface MockEmbeddingErrorShape {
  status?: unknown
  isBYOK?: unknown
  quotaExhausted?: unknown
}

function readErrorShape(error: unknown): MockEmbeddingErrorShape | null {
  return typeof error === 'object' && error !== null ? (error as MockEmbeddingErrorShape) : null
}

function isQuotaExhaustion(error: unknown): boolean {
  if (error instanceof AggregateError) {
    return error.errors.length > 0 && error.errors.every(isQuotaExhaustion)
  }
  const shape = readErrorShape(error)
  if (shape === null) return false
  if ((error as Error).name === 'ProviderQuotaExhaustedError') return true
  return shape.quotaExhausted === true
}

/**
 * Controllable mock functions for `@/lib/embeddings`.
 *
 * Defaults:
 * - `mockAssertKnowledgeEmbeddingCapacity` resolves `undefined` (capacity admitted).
 * - `mockEmbedKnowledge` resolves one `[1, 0, …]` 1536-wide vector per input, `totalTokens` =
 *   input count, `billableTokens: 0`, `isBYOK: true`, model/pricing `text-embedding-3-small`.
 * - `mockToOllamaEmbeddingModelId` and `mockGetEmbeddingAggregateItemLimit` port the real logic.
 * - `mockIsEmbeddingQuotaExhaustion` / `mockIsBYOKEmbeddingCredentialRejection` port the real
 *   checks structurally (fields, not `instanceof`), including `AggregateError` recursion.
 * - `mockEmbed`, `mockEmbedOpenRouter`, `mockFindEmbeddingModelInfo`, `mockResolveDimensions` are bare.
 *
 * @example
 * ```ts
 * import { embeddingsMockFns } from '@sim/testing/mocks/embeddings.mock'
 *
 * embeddingsMockFns.mockEmbed.mockResolvedValue({ embeddings: [[0.1]], totalTokens: 1 })
 * ```
 */
export const embeddingsMockFns = {
  mockFindEmbeddingModelInfo: vi.fn(),
  mockResolveDimensions: vi.fn(),
  mockToOllamaEmbeddingModelId: vi.fn((model: string): string => {
    const name = (
      model.startsWith(OLLAMA_EMBEDDING_MODEL_PREFIX)
        ? model.slice(OLLAMA_EMBEDDING_MODEL_PREFIX.length)
        : model
    ).trim()
    if (!name) throw new Error('Ollama embedding model name is required')
    return `${OLLAMA_EMBEDDING_MODEL_PREFIX}${name}`
  }),
  mockAssertKnowledgeEmbeddingCapacity: vi.fn(async (..._args: unknown[]): Promise<void> => {}),
  mockEmbed: vi.fn(),
  mockEmbedKnowledge: vi.fn(async (texts: string[], ..._args: unknown[]) => ({
    embeddings: texts.map(() => [1, ...Array<number>(1535).fill(0)]),
    totalTokens: texts.length,
    billableTokens: 0,
    isBYOK: true,
    modelName: 'text-embedding-3-small',
    pricingId: 'text-embedding-3-small',
  })),
  mockEmbedOpenRouter: vi.fn(),
  mockGetEmbeddingAggregateItemLimit: vi.fn((dimensions: number): number => {
    if (!Number.isInteger(dimensions) || dimensions <= 0) {
      throw new Error('Embedding dimensions must be a positive integer')
    }
    return Math.floor(
      (MAX_EMBEDDING_AGGREGATE_RESPONSE_BYTES - EMBEDDING_RESPONSE_ENVELOPE_RESERVE_BYTES) /
        (dimensions * EMBEDDING_RESPONSE_BYTES_PER_DIMENSION + EMBEDDING_RESPONSE_BYTES_PER_ITEM)
    )
  }),
  mockIsBYOKEmbeddingCredentialRejection: vi.fn((error: unknown): boolean => {
    const shape = readErrorShape(error)
    return (
      shape !== null &&
      shape.isBYOK === true &&
      shape.quotaExhausted !== true &&
      (shape.status === 401 || shape.status === 403)
    )
  }),
  mockIsEmbeddingQuotaExhaustion: vi.fn(isQuotaExhaustion),
}

/**
 * Static mock module for `@/lib/embeddings`. Constants carry the real values; the error class is
 * {@link MockEmbeddingOutputLimitError}.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/embeddings', () => embeddingsMock)
 * ```
 */
export const embeddingsMock = {
  DEFAULT_MODEL_BY_PROVIDER: {
    openai: 'text-embedding-3-small',
    gemini: 'gemini-embedding-001',
    cohere: 'embed-v4.0',
    mistral: 'mistral-embed',
  },
  DEFAULT_OPENROUTER_EMBEDDING_MODEL: 'openrouter/openai/text-embedding-3-small',
  BYOK_EMBEDDING_CREDENTIAL_REJECTION_MESSAGE:
    'The configured embedding API key was rejected. Update the key and retry this document.',
  EMBEDDING_QUOTA_EXHAUSTED_MESSAGE:
    'The embedding provider has exhausted its available quota. Add credit or replace the credential before retrying.',
  EmbeddingOutputLimitError: MockEmbeddingOutputLimitError,
  findEmbeddingModelInfo: embeddingsMockFns.mockFindEmbeddingModelInfo,
  resolveDimensions: embeddingsMockFns.mockResolveDimensions,
  toOllamaEmbeddingModelId: embeddingsMockFns.mockToOllamaEmbeddingModelId,
  assertKnowledgeEmbeddingCapacity: embeddingsMockFns.mockAssertKnowledgeEmbeddingCapacity,
  embed: embeddingsMockFns.mockEmbed,
  embedKnowledge: embeddingsMockFns.mockEmbedKnowledge,
  embedOpenRouter: embeddingsMockFns.mockEmbedOpenRouter,
  getEmbeddingAggregateItemLimit: embeddingsMockFns.mockGetEmbeddingAggregateItemLimit,
  isBYOKEmbeddingCredentialRejection: embeddingsMockFns.mockIsBYOKEmbeddingCredentialRejection,
  isEmbeddingQuotaExhaustion: embeddingsMockFns.mockIsEmbeddingQuotaExhaustion,
}

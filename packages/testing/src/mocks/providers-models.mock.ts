import { vi } from 'vitest'

/** Shape of a provider attachment policy (`ProviderFileAttachment`). */
interface MockProviderFileAttachment {
  maxBytes: number
  strategy: 'inline' | 'files-api' | 'remote-url'
}

/** Shape of a model pricing entry (`ModelPricing`). */
interface MockModelPricing {
  input: number
  output: number
  cachedInput?: number
  updatedAt: string
}

/** Shape of a rerank pricing entry. */
interface MockRerankPricing {
  perSearchUnit: number
  updatedAt: string
}

const INLINE_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024

const EMBEDDING_MODEL_PRICING: Record<string, MockModelPricing> = {
  'text-embedding-3-small': { input: 0.02, output: 0.0, updatedAt: '2026-04-01' },
  'text-embedding-3-large': { input: 0.13, output: 0.0, updatedAt: '2026-04-01' },
  'text-embedding-ada-002': { input: 0.1, output: 0.0, updatedAt: '2026-04-01' },
  'gemini-embedding-001': { input: 0.15, output: 0.0, updatedAt: '2026-04-29' },
  'embed-v4.0': { input: 0.12, output: 0.0, updatedAt: '2026-08-05' },
  'mistral-embed': { input: 0.1, output: 0.0, updatedAt: '2026-08-05' },
  'codestral-embed': { input: 0.15, output: 0.0, updatedAt: '2026-08-05' },
}

const RERANK_MODEL_PRICING: Record<string, MockRerankPricing> = {
  'rerank-v4.0-pro': { perSearchUnit: 0.0025, updatedAt: '2026-04-29' },
  'rerank-v4.0-fast': { perSearchUnit: 0.002, updatedAt: '2026-04-29' },
  'rerank-v3.5': { perSearchUnit: 0.002, updatedAt: '2026-04-29' },
}

/**
 * Controllable mock functions for `@/providers/models`.
 *
 * The real module is a ~6k-line model catalog; this mock carries NO catalog. Every default is the
 * real function's answer against an empty catalog (or a neutral value), independent of
 * {@link providersModelsMock.PROVIDER_DEFINITIONS}:
 * - `getProviderFileAttachment` → `{ maxBytes: 10 MiB, strategy: 'inline' }` (the real default policy);
 * - `getProviderModels` / `getStaticProviderModels` / every `get*Models` list → `[]`,
 *   `orderModelIdsByReleaseDate(ids)` → a copy of `ids` (all unknown keep input order);
 * - `getProviderDefaultModel` → `''`, `getBaseModelProviders` → `{}`;
 * - `findProviderFromModel` → `null`, `getProviderFromModel` → `'openai'` (matches
 *   `providers-utils.mock`; the real empty-catalog answer would be `'ollama'`);
 * - `isAutoModel` is the real check against `'sim-auto'`;
 * - `getMaxOutputTokensForModel` → `4096` (the real standard fallback);
 * - `getEmbeddingModelPricing` / `getRerankModelPricing` are real lookups in the copied constants;
 * - lookups (`getModelPricing`, `getModelCapabilities`, `getProviderIcon`, `getThinkingCapability`,
 *   `getThinkingStreamVisibility`, `get*ValuesForModel`, `getThinkingLevelsForModel`) → `null`,
 *   `getModelSunsetStatus` / `getMaxTemperature` → `undefined`;
 * - predicates (`isKnownModelId`, `isCustomModelId`, `isModelDeprecated`, `supports*`,
 *   `isKnownModelLevelValue`, `isEvaluationModel`) → `false`, `suggestModelIdsForUnknownModel` → `[]`;
 * - `update*Models` are no-ops.
 *
 * @example
 * ```ts
 * import { providersModelsMockFns } from '@sim/testing/mocks/providers-models.mock'
 *
 * providersModelsMockFns.mockGetProviderDefaultModel.mockReturnValue('deepseek-chat')
 * providersModelsMockFns.mockGetModelCapabilities.mockReturnValue({ temperature: { min: 0, max: 1 } })
 * ```
 */
export const providersModelsMockFns = {
  mockGetProviderFileAttachment: vi.fn(
    (_providerId: string): MockProviderFileAttachment => ({
      maxBytes: INLINE_ATTACHMENT_MAX_BYTES,
      strategy: 'inline',
    })
  ),
  mockGetProviderModels: vi.fn((_providerId: string): string[] => []),
  mockGetStaticProviderModels: vi.fn((_providerId: string): unknown[] => []),
  mockOrderModelIdsByReleaseDate: vi.fn((modelIds: string[]): string[] => [...modelIds]),
  mockIsKnownModelId: vi.fn((_modelId: string): boolean => false),
  mockGetModelSunsetStatus: vi.fn(
    (_modelId: string | undefined | null): 'legacy' | 'deprecated' | undefined => undefined
  ),
  mockIsModelDeprecated: vi.fn((_modelId: string | undefined | null): boolean => false),
  mockSuggestModelIdsForUnknownModel: vi.fn((_modelId: string, _limit?: number): string[] => []),
  mockIsAutoModel: vi.fn((model: string): boolean => model.trim().toLowerCase() === 'sim-auto'),
  mockGetBaseModelProviders: vi.fn((): Record<string, string> => ({})),
  mockFindProviderFromModel: vi.fn((_model: string): string | null => null),
  mockGetProviderFromModel: vi.fn((_model: string): string => 'openai'),
  mockIsCustomModelId: vi.fn((_modelId: string): boolean => false),
  mockGetProviderIcon: vi.fn((_model: string): unknown => null),
  mockGetProviderDefaultModel: vi.fn((_providerId: string): string => ''),
  mockGetModelPricing: vi.fn((_modelId: string): MockModelPricing | null => null),
  mockGetModelCapabilities: vi.fn((_modelId: string): Record<string, unknown> | null => null),
  mockGetProvidersWithToolUsageControl: vi.fn((): string[] => []),
  mockGetHostedModels: vi.fn((): string[] => []),
  mockGetComputerUseModels: vi.fn((): string[] => []),
  mockSupportsTemperature: vi.fn((_modelId: string): boolean => false),
  mockGetMaxTemperature: vi.fn((_modelId: string): number | undefined => undefined),
  mockSupportsToolUsageControl: vi.fn((_providerId: string): boolean => false),
  mockSupportsForcedToolUse: vi.fn((_modelId: string): boolean => false),
  mockUpdateOllamaModels: vi.fn((_models: string[]): void => {}),
  mockUpdateVLLMModels: vi.fn((_models: string[]): void => {}),
  mockUpdateLiteLLMModels: vi.fn((_models: string[]): void => {}),
  mockUpdateFireworksModels: vi.fn((_models: string[]): void => {}),
  mockUpdateTogetherModels: vi.fn((_models: string[]): void => {}),
  mockUpdateBasetenModels: vi.fn((_models: string[]): void => {}),
  mockUpdateOllamaCloudModels: vi.fn((_models: string[]): void => {}),
  mockUpdateOpenRouterModels: vi.fn((_models: string[]): void => {}),
  mockGetEmbeddingModelPricing: vi.fn(
    (modelId: string): MockModelPricing | null => EMBEDDING_MODEL_PRICING[modelId] || null
  ),
  mockGetRerankModelPricing: vi.fn(
    (modelId: string): MockRerankPricing | null => RERANK_MODEL_PRICING[modelId] || null
  ),
  mockGetModelsWithReasoningEffort: vi.fn((): string[] => []),
  mockGetReasoningEffortValuesForModel: vi.fn((_modelId: string): string[] | null => null),
  mockGetModelsWithVerbosity: vi.fn((): string[] => []),
  mockGetVerbosityValuesForModel: vi.fn((_modelId: string): string[] | null => null),
  mockSupportsNativeStructuredOutputs: vi.fn((_modelId: string): boolean => false),
  mockGetThinkingCapability: vi.fn((_modelId: string): unknown => null),
  mockGetModelsWithPromptCaching: vi.fn((): string[] => []),
  mockGetModelsWithThinking: vi.fn((): string[] => []),
  mockGetThinkingLevelsForModel: vi.fn((_modelId: string): string[] | null => null),
  mockIsKnownModelLevelValue: vi.fn((_value: string): boolean => false),
  mockGetThinkingStreamVisibility: vi.fn(
    (_modelId: string): 'full' | 'summary' | 'none' | null => null
  ),
  mockGetEvaluationModels: vi.fn((): string[] => []),
  mockIsEvaluationModel: vi.fn((_modelId: string): boolean => false),
  mockGetModelsWithDeepResearch: vi.fn((): string[] => []),
  mockGetModelsWithoutMemory: vi.fn((): string[] => []),
  mockGetMaxOutputTokensForModel: vi.fn((_modelId: string): number => 4096),
}

/**
 * Static mock module for `@/providers/models`. Covers every runtime export.
 *
 * Constants carry the real values (`INLINE_ATTACHMENT_MAX_BYTES` 10 MiB,
 * `LARGE_FILE_PATH_THRESHOLD_BYTES` 6 MiB, `SIM_AUTO_MODEL_ID`, `DYNAMIC_MODEL_PROVIDERS`, the
 * embedding/rerank pricing tables) except `PROVIDER_DEFINITIONS`, which is an empty mutable
 * object: a suite that needs a catalog spreads it in the factory
 * (`vi.mock('@/providers/models', () => ({ ...providersModelsMock, PROVIDER_DEFINITIONS: { … } }))`)
 * — no mock function reads it.
 *
 * @example
 * ```ts
 * vi.mock('@/providers/models', () => providersModelsMock)
 * ```
 */
export const providersModelsMock = {
  INLINE_ATTACHMENT_MAX_BYTES,
  LARGE_FILE_PATH_THRESHOLD_BYTES: Math.floor((8 * 1024 * 1024) / 4) * 3,
  PROVIDER_DEFINITIONS: {} as Record<string, unknown>,
  DYNAMIC_MODEL_PROVIDERS: [
    'ollama',
    'ollama-cloud',
    'vllm',
    'litellm',
    'openrouter',
    'fireworks',
    'together',
    'baseten',
  ] as const,
  SIM_AUTO_MODEL_ID: 'sim-auto',
  EMBEDDING_MODEL_PRICING,
  RERANK_MODEL_PRICING,
  getProviderFileAttachment: providersModelsMockFns.mockGetProviderFileAttachment,
  getProviderModels: providersModelsMockFns.mockGetProviderModels,
  getStaticProviderModels: providersModelsMockFns.mockGetStaticProviderModels,
  orderModelIdsByReleaseDate: providersModelsMockFns.mockOrderModelIdsByReleaseDate,
  isKnownModelId: providersModelsMockFns.mockIsKnownModelId,
  getModelSunsetStatus: providersModelsMockFns.mockGetModelSunsetStatus,
  isModelDeprecated: providersModelsMockFns.mockIsModelDeprecated,
  suggestModelIdsForUnknownModel: providersModelsMockFns.mockSuggestModelIdsForUnknownModel,
  isAutoModel: providersModelsMockFns.mockIsAutoModel,
  getBaseModelProviders: providersModelsMockFns.mockGetBaseModelProviders,
  findProviderFromModel: providersModelsMockFns.mockFindProviderFromModel,
  getProviderFromModel: providersModelsMockFns.mockGetProviderFromModel,
  isCustomModelId: providersModelsMockFns.mockIsCustomModelId,
  getProviderIcon: providersModelsMockFns.mockGetProviderIcon,
  getProviderDefaultModel: providersModelsMockFns.mockGetProviderDefaultModel,
  getModelPricing: providersModelsMockFns.mockGetModelPricing,
  getModelCapabilities: providersModelsMockFns.mockGetModelCapabilities,
  getProvidersWithToolUsageControl: providersModelsMockFns.mockGetProvidersWithToolUsageControl,
  getHostedModels: providersModelsMockFns.mockGetHostedModels,
  getComputerUseModels: providersModelsMockFns.mockGetComputerUseModels,
  supportsTemperature: providersModelsMockFns.mockSupportsTemperature,
  getMaxTemperature: providersModelsMockFns.mockGetMaxTemperature,
  supportsToolUsageControl: providersModelsMockFns.mockSupportsToolUsageControl,
  supportsForcedToolUse: providersModelsMockFns.mockSupportsForcedToolUse,
  updateOllamaModels: providersModelsMockFns.mockUpdateOllamaModels,
  updateVLLMModels: providersModelsMockFns.mockUpdateVLLMModels,
  updateLiteLLMModels: providersModelsMockFns.mockUpdateLiteLLMModels,
  updateFireworksModels: providersModelsMockFns.mockUpdateFireworksModels,
  updateTogetherModels: providersModelsMockFns.mockUpdateTogetherModels,
  updateBasetenModels: providersModelsMockFns.mockUpdateBasetenModels,
  updateOllamaCloudModels: providersModelsMockFns.mockUpdateOllamaCloudModels,
  updateOpenRouterModels: providersModelsMockFns.mockUpdateOpenRouterModels,
  getEmbeddingModelPricing: providersModelsMockFns.mockGetEmbeddingModelPricing,
  getRerankModelPricing: providersModelsMockFns.mockGetRerankModelPricing,
  getModelsWithReasoningEffort: providersModelsMockFns.mockGetModelsWithReasoningEffort,
  getReasoningEffortValuesForModel: providersModelsMockFns.mockGetReasoningEffortValuesForModel,
  getModelsWithVerbosity: providersModelsMockFns.mockGetModelsWithVerbosity,
  getVerbosityValuesForModel: providersModelsMockFns.mockGetVerbosityValuesForModel,
  supportsNativeStructuredOutputs: providersModelsMockFns.mockSupportsNativeStructuredOutputs,
  getThinkingCapability: providersModelsMockFns.mockGetThinkingCapability,
  getModelsWithPromptCaching: providersModelsMockFns.mockGetModelsWithPromptCaching,
  getModelsWithThinking: providersModelsMockFns.mockGetModelsWithThinking,
  getThinkingLevelsForModel: providersModelsMockFns.mockGetThinkingLevelsForModel,
  isKnownModelLevelValue: providersModelsMockFns.mockIsKnownModelLevelValue,
  getThinkingStreamVisibility: providersModelsMockFns.mockGetThinkingStreamVisibility,
  getEvaluationModels: providersModelsMockFns.mockGetEvaluationModels,
  isEvaluationModel: providersModelsMockFns.mockIsEvaluationModel,
  getModelsWithDeepResearch: providersModelsMockFns.mockGetModelsWithDeepResearch,
  getModelsWithoutMemory: providersModelsMockFns.mockGetModelsWithoutMemory,
  getMaxOutputTokensForModel: providersModelsMockFns.mockGetMaxOutputTokensForModel,
}

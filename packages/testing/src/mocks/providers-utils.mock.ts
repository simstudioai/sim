import { vi } from 'vitest'

/** Shape of `calculateCost`'s result the provider code reads. */
interface MockCost {
  input: number
  output: number
  total: number
  pricing?: unknown
}

/** Shape of `prepareToolsWithUsageControl`'s result the provider code reads. */
interface MockPreparedTools {
  tools: unknown[] | undefined
  toolChoice: unknown
  toolConfig?: unknown
  hasFilteredTools: boolean
  forcedTools: string[]
}

/** Shape of `trackForcedToolUsage` / `checkForForcedToolUsageOpenAI` results. */
interface MockForcedToolUsage {
  hasUsedForcedTool: boolean
  usedForcedTools: string[]
  nextToolChoice?: unknown
  nextToolConfig?: unknown
}

/**
 * Controllable mock functions for `@/providers/utils`.
 *
 * Defaults follow what provider tests stub most often, so a provider's tool loop runs without a
 * model catalog:
 * - `isFunctionToolCall` is the real guard (a `function` payload is present);
 * - `calculateCost` → `{ input: 0, output: 0, total: 0 }`, `sumToolCosts` is the real sum of
 *   `cost.total` (0 when there are none), `formatCost` → `'—'`;
 * - `prepareToolExecution(tool, args)` → `{ toolParams: args, executionParams: args }`;
 * - `prepareToolsWithUsageControl(tools)` passes tools through with `toolChoice: 'auto'` (or
 *   `undefined` tools/choice when none), `forcedTools: []`, `hasFilteredTools: false` — the real
 *   result when no tool has a usage control;
 * - `trackForcedToolUsage` / `checkForForcedToolUsageOpenAI` → nothing forced, used list unchanged;
 * - `enforceStrictSchema` and `filterBlacklistedModels` are identity; `isProviderBlacklisted`,
 *   `shouldBillModelUsage` and every `supports*`/`is*Model` capability check → `false`;
 * - `getProviderFromModel` → `'openai'`, `findProviderFromModel` → `null`;
 * - `generateSchemaInstructions` → `'SCHEMA_INSTRUCTIONS'`;
 * - `getApiKey` returns the user key, else the real `PROVIDER_PLACEHOLDER_KEY`;
 * - the `MODELS_WITH_*` catalog constants are empty arrays and `providers` is `{}`.
 *
 * @example
 * ```ts
 * import { providersUtilsMockFns } from '@sim/testing/mocks/providers-utils.mock'
 *
 * providersUtilsMockFns.mockCalculateCost.mockReturnValue({ input: 0.01, output: 0.02, total: 0.03 })
 * providersUtilsMockFns.mockSupportsReasoningEffort.mockImplementation((m) => m === 'o3')
 * ```
 */
export const providersUtilsMockFns = {
  mockUpdateOllamaProviderModels: vi.fn((_models: string[]): void => {}),
  mockUpdateVLLMProviderModels: vi.fn((_models: string[]): void => {}),
  mockUpdateLiteLLMProviderModels: vi.fn((_models: string[]): void => {}),
  mockUpdateOpenRouterProviderModels: vi.fn(async (_models: string[]): Promise<void> => {}),
  mockUpdateFireworksProviderModels: vi.fn(async (_models: string[]): Promise<void> => {}),
  mockUpdateOllamaCloudProviderModels: vi.fn(async (_models: string[]): Promise<void> => {}),
  mockUpdateTogetherProviderModels: vi.fn(async (_models: string[]): Promise<void> => {}),
  mockUpdateBasetenProviderModels: vi.fn(async (_models: string[]): Promise<void> => {}),
  mockGetBaseModelProviders: vi.fn((): Record<string, string> => ({})),
  mockFindProviderFromModel: vi.fn((_model: string): string | null => null),
  mockGetProviderFromModel: vi.fn((_model: string): string => 'openai'),
  mockGetProvider: vi.fn((_id: string): unknown => undefined),
  mockGetAllProviderIds: vi.fn((): string[] => []),
  mockGetProviderModels: vi.fn((_providerId: string): string[] => []),
  mockIsProviderBlacklisted: vi.fn((_providerId: string): boolean => false),
  mockFilterBlacklistedModels: vi.fn((models: string[]): string[] => models),
  mockGetProviderIcon: vi.fn((_model: string): unknown => null),
  mockGenerateSchemaInstructions: vi.fn(
    (_schema: unknown, _schemaName?: string): string => 'SCHEMA_INSTRUCTIONS'
  ),
  mockGenerateStructuredOutputInstructions: vi.fn((_responseFormat: unknown): string => ''),
  mockExtractAndParseJSON: vi.fn((content: string): unknown => JSON.parse(content)),
  mockBuildBlockToolParamsTransform: vi.fn(),
  mockTransformBlockTool: vi.fn(),
  mockCalculateCost: vi.fn((..._args: unknown[]): MockCost => ({ input: 0, output: 0, total: 0 })),
  mockEnforceStrictSchema: vi.fn(
    (schema: Record<string, unknown>): Record<string, unknown> => schema
  ),
  mockSumToolCosts: vi.fn((toolResults?: Record<string, unknown>[]): number => {
    if (!toolResults?.length) return 0
    let total = 0
    for (const result of toolResults) {
      const cost = result?.cost as Record<string, unknown> | undefined
      if (cost?.total && typeof cost.total === 'number') total += cost.total
    }
    return total
  }),
  mockGetModelPricing: vi.fn((_modelId: string): unknown => null),
  mockFormatCost: vi.fn((_cost: number): string => '—'),
  mockGetHostedModels: vi.fn((): string[] => []),
  mockShouldBillModelUsage: vi.fn((_model: string): boolean => false),
  mockGetApiKey: vi.fn(
    (_provider: string, _model: string, userProvidedKey?: string): string =>
      userProvidedKey || 'provider-uses-own-credentials'
  ),
  mockPrepareToolsWithUsageControl: vi.fn(
    (tools: unknown[] | undefined, ..._rest: unknown[]): MockPreparedTools => ({
      tools: tools?.length ? tools : undefined,
      toolChoice: tools?.length ? 'auto' : undefined,
      hasFilteredTools: false,
      forcedTools: [],
    })
  ),
  mockIsFunctionToolCall: vi.fn(
    (toolCall: unknown): boolean =>
      typeof toolCall === 'object' &&
      toolCall !== null &&
      'function' in toolCall &&
      (toolCall as { function?: unknown }).function != null
  ),
  mockTrackForcedToolUsage: vi.fn(
    (
      _toolCallsResponse: unknown,
      _originalToolChoice: unknown,
      _logger: unknown,
      _provider?: string,
      _forcedTools: string[] = [],
      usedForcedTools: string[] = []
    ): MockForcedToolUsage => ({ hasUsedForcedTool: false, usedForcedTools })
  ),
  mockSupportsTemperature: vi.fn((_model: string): boolean => false),
  mockDescribeModelLevel: vi.fn((value: string | undefined): string => value || '(unset)'),
  mockSupportsReasoningEffort: vi.fn((_model: string): boolean => false),
  mockSupportsVerbosity: vi.fn((_model: string): boolean => false),
  mockSupportsThinking: vi.fn((_model: string): boolean => false),
  mockSupportsPromptCaching: vi.fn((_model: string): boolean => false),
  mockIsDeepResearchModel: vi.fn((_model: string): boolean => false),
  mockIsGemini3Model: vi.fn((_model: string): boolean => false),
  mockGetMaxTemperature: vi.fn((_model: string): number | undefined => undefined),
  mockSupportsToolUsageControl: vi.fn((_provider: string): boolean => false),
  mockGetReasoningEffortValuesForModel: vi.fn((_model: string): string[] | null => null),
  mockGetVerbosityValuesForModel: vi.fn((_model: string): string[] | null => null),
  mockGetThinkingLevelsForModel: vi.fn((_model: string): string[] | null => null),
  mockGetMaxOutputTokensForModel: vi.fn((_model: string): number => 4096),
  mockPrepareToolExecution: vi.fn(
    (
      _tool: unknown,
      llmArgs: Record<string, unknown>,
      ..._rest: unknown[]
    ): { toolParams: Record<string, unknown>; executionParams: Record<string, unknown> } => ({
      toolParams: llmArgs,
      executionParams: llmArgs,
    })
  ),
  mockCheckForForcedToolUsageOpenAI: vi.fn(
    (
      _response: unknown,
      _toolChoice: unknown,
      _providerName: string,
      _forcedTools: string[],
      usedForcedTools: string[]
    ): MockForcedToolUsage => ({ hasUsedForcedTool: false, usedForcedTools })
  ),
}

/**
 * Static mock module for `@/providers/utils`. Mocking it keeps the model catalog, block graph and
 * tool param machinery the real module imports out of the test.
 *
 * @example
 * ```ts
 * vi.mock('@/providers/utils', () => providersUtilsMock)
 * ```
 */
export const providersUtilsMock = {
  providers: {} as Record<string, unknown>,
  PROVIDER_PLACEHOLDER_KEY: 'provider-uses-own-credentials',
  MODELS_WITH_REASONING_EFFORT: [] as string[],
  MODELS_WITH_VERBOSITY: [] as string[],
  MODELS_WITH_THINKING: [] as string[],
  MODELS_WITH_PROMPT_CACHING: [] as string[],
  MODELS_WITH_DEEP_RESEARCH: [] as string[],
  MODELS_WITHOUT_MEMORY: [] as string[],
  updateOllamaProviderModels: providersUtilsMockFns.mockUpdateOllamaProviderModels,
  updateVLLMProviderModels: providersUtilsMockFns.mockUpdateVLLMProviderModels,
  updateLiteLLMProviderModels: providersUtilsMockFns.mockUpdateLiteLLMProviderModels,
  updateOpenRouterProviderModels: providersUtilsMockFns.mockUpdateOpenRouterProviderModels,
  updateFireworksProviderModels: providersUtilsMockFns.mockUpdateFireworksProviderModels,
  updateOllamaCloudProviderModels: providersUtilsMockFns.mockUpdateOllamaCloudProviderModels,
  updateTogetherProviderModels: providersUtilsMockFns.mockUpdateTogetherProviderModels,
  updateBasetenProviderModels: providersUtilsMockFns.mockUpdateBasetenProviderModels,
  getBaseModelProviders: providersUtilsMockFns.mockGetBaseModelProviders,
  findProviderFromModel: providersUtilsMockFns.mockFindProviderFromModel,
  getProviderFromModel: providersUtilsMockFns.mockGetProviderFromModel,
  getProvider: providersUtilsMockFns.mockGetProvider,
  getAllProviderIds: providersUtilsMockFns.mockGetAllProviderIds,
  getProviderModels: providersUtilsMockFns.mockGetProviderModels,
  isProviderBlacklisted: providersUtilsMockFns.mockIsProviderBlacklisted,
  filterBlacklistedModels: providersUtilsMockFns.mockFilterBlacklistedModels,
  getProviderIcon: providersUtilsMockFns.mockGetProviderIcon,
  generateSchemaInstructions: providersUtilsMockFns.mockGenerateSchemaInstructions,
  generateStructuredOutputInstructions:
    providersUtilsMockFns.mockGenerateStructuredOutputInstructions,
  extractAndParseJSON: providersUtilsMockFns.mockExtractAndParseJSON,
  buildBlockToolParamsTransform: providersUtilsMockFns.mockBuildBlockToolParamsTransform,
  transformBlockTool: providersUtilsMockFns.mockTransformBlockTool,
  calculateCost: providersUtilsMockFns.mockCalculateCost,
  enforceStrictSchema: providersUtilsMockFns.mockEnforceStrictSchema,
  sumToolCosts: providersUtilsMockFns.mockSumToolCosts,
  getModelPricing: providersUtilsMockFns.mockGetModelPricing,
  formatCost: providersUtilsMockFns.mockFormatCost,
  getHostedModels: providersUtilsMockFns.mockGetHostedModels,
  shouldBillModelUsage: providersUtilsMockFns.mockShouldBillModelUsage,
  getApiKey: providersUtilsMockFns.mockGetApiKey,
  prepareToolsWithUsageControl: providersUtilsMockFns.mockPrepareToolsWithUsageControl,
  isFunctionToolCall: providersUtilsMockFns.mockIsFunctionToolCall,
  trackForcedToolUsage: providersUtilsMockFns.mockTrackForcedToolUsage,
  supportsTemperature: providersUtilsMockFns.mockSupportsTemperature,
  describeModelLevel: providersUtilsMockFns.mockDescribeModelLevel,
  supportsReasoningEffort: providersUtilsMockFns.mockSupportsReasoningEffort,
  supportsVerbosity: providersUtilsMockFns.mockSupportsVerbosity,
  supportsThinking: providersUtilsMockFns.mockSupportsThinking,
  supportsPromptCaching: providersUtilsMockFns.mockSupportsPromptCaching,
  isDeepResearchModel: providersUtilsMockFns.mockIsDeepResearchModel,
  isGemini3Model: providersUtilsMockFns.mockIsGemini3Model,
  getMaxTemperature: providersUtilsMockFns.mockGetMaxTemperature,
  supportsToolUsageControl: providersUtilsMockFns.mockSupportsToolUsageControl,
  getReasoningEffortValuesForModel: providersUtilsMockFns.mockGetReasoningEffortValuesForModel,
  getVerbosityValuesForModel: providersUtilsMockFns.mockGetVerbosityValuesForModel,
  getThinkingLevelsForModel: providersUtilsMockFns.mockGetThinkingLevelsForModel,
  getMaxOutputTokensForModel: providersUtilsMockFns.mockGetMaxOutputTokensForModel,
  prepareToolExecution: providersUtilsMockFns.mockPrepareToolExecution,
  checkForForcedToolUsageOpenAI: providersUtilsMockFns.mockCheckForForcedToolUsageOpenAI,
}

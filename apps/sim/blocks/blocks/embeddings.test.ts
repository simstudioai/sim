/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_MODEL_BY_PROVIDER, EMBEDDING_MODELS } from '@/lib/embeddings/catalog'
import { DEFAULT_OPENROUTER_EMBEDDING_MODEL } from '@/lib/embeddings/openrouter-models'
import {
  EMBEDDING_BLOCK_PROVIDERS,
  EmbeddingsBlock,
  TOOL_ID_BY_PROVIDER,
} from '@/blocks/blocks/embeddings'

/**
 * The block derives its model, task-type, and dimension options from the
 * catalog, so these assert the derivation still produces what the UI expects:
 * one dropdown per provider/model, the catalog's own option sets, and the
 * native size pre-selected. They also pin the provider-to-tool routing.
 */

function subBlocksById(id: string) {
  return EmbeddingsBlock.subBlocks.filter((sb) => sb.id === id)
}

function optionIds(options: unknown): string[] {
  const resolved = typeof options === 'function' ? options() : options
  return Array.isArray(resolved) ? resolved.map((option) => (option as { id: string }).id) : []
}

/** The provider a `{ field: 'provider', value: X }` condition selects. */
function conditionProvider(subBlock: { condition?: unknown }): string | undefined {
  const condition = subBlock.condition as
    | { field?: string; value?: unknown; and?: { field?: string; value?: unknown } }
    | undefined
  return typeof condition?.value === 'string' ? condition.value : undefined
}

function conditionModel(subBlock: { condition?: unknown }): string | undefined {
  const condition = subBlock.condition as { and?: { field?: string; value?: unknown } } | undefined
  return typeof condition?.and?.value === 'string' ? condition.and.value : undefined
}

describe('Embeddings block', () => {
  it('offers static catalog models for direct providers', () => {
    const modelSubBlocks = subBlocksById('model')
    const offered = new Map<string, string[]>()

    for (const subBlock of modelSubBlocks) {
      const provider = conditionProvider(subBlock)
      expect(provider).toBeDefined()
      if (provider === 'openrouter') continue
      offered.set(provider as string, optionIds(subBlock.options))
    }

    const expected = new Map<string, string[]>()
    for (const provider of EMBEDDING_BLOCK_PROVIDERS) {
      if (provider === 'openrouter') continue
      expected.set(
        provider,
        Object.entries(EMBEDDING_MODELS).flatMap(([modelId, info]) =>
          info.provider === provider ? [modelId] : []
        )
      )
    }

    expect([...offered.keys()].sort()).toEqual([...expected.keys()].sort())
    for (const [provider, models] of expected) {
      expect(offered.get(provider)?.slice().sort()).toEqual(models.slice().sort())
    }
  })

  it('defaults each provider to a model that provider actually owns', () => {
    for (const [provider, model] of Object.entries(DEFAULT_MODEL_BY_PROVIDER)) {
      expect(EMBEDDING_MODELS[model]).toBeDefined()
      expect(EMBEDDING_MODELS[model].provider).toBe(provider)
    }
  })

  it('shows a task-type dropdown for exactly the models that support one', () => {
    const withTaskTypes = Object.entries(EMBEDDING_MODELS).flatMap(([id, info]) => {
      if (!info.supportedTaskTypes) return []
      return [`${info.provider}:${id}`]
    })

    const subBlocks = subBlocksById('taskType')
    expect(
      subBlocks
        .map((subBlock) => `${conditionProvider(subBlock)}:${conditionModel(subBlock)}`)
        .sort()
    ).toEqual(withTaskTypes.slice().sort())

    for (const subBlock of subBlocks) {
      const model = conditionModel(subBlock) as string
      expect(optionIds(subBlock.options)).toEqual([
        ...(EMBEDDING_MODELS[model].supportedTaskTypes ?? []),
      ])
    }
  })

  it('shows a dimensions dropdown for exactly the models that support reduction', () => {
    const withDimensions = Object.entries(EMBEDDING_MODELS).flatMap(([id, info]) => {
      if (!info.supportedDimensions) return []
      return [`${info.provider}:${id}`]
    })

    const subBlocks = subBlocksById('dimensions')
    expect(
      subBlocks
        .map((subBlock) => `${conditionProvider(subBlock)}:${conditionModel(subBlock)}`)
        .sort()
    ).toEqual(withDimensions.slice().sort())

    for (const subBlock of subBlocks) {
      const model = conditionModel(subBlock) as string
      const info = EMBEDDING_MODELS[model]
      expect(optionIds(subBlock.options)).toEqual(
        (info.supportedDimensions ?? []).map((size) => String(size))
      )
      // The pre-selected value must be the model's native size.
      expect(subBlock.value?.()).toBe(String(info.nativeDimensions))
    }
  })

  it('routes every provider to a tool it declares access to', () => {
    for (const [provider, toolId] of Object.entries(TOOL_ID_BY_PROVIDER)) {
      expect(EmbeddingsBlock.tools.access).toContain(toolId)
      expect(EmbeddingsBlock.tools.config?.tool?.({ provider })).toBe(toolId)
    }
    expect(EmbeddingsBlock.tools.access).toHaveLength(Object.keys(TOOL_ID_BY_PROVIDER).length)
    expect(EmbeddingsBlock.tools.config?.tool?.({})).toBe('embeddings_openai')
    expect(() => EmbeddingsBlock.tools.config?.tool?.({ provider: 'unknown' })).toThrow(
      'Unsupported embedding provider: unknown'
    )
  })

  it('uses the server-backed OpenRouter model selector and maps its dedicated key', () => {
    const openRouterModels = subBlocksById('model').find(
      (subBlock) => conditionProvider(subBlock) === 'openrouter'
    )
    expect(openRouterModels?.type).toBe('combobox')
    expect(openRouterModels?.selectorKey).toBe('providers.openrouterEmbeddingModels')

    expect(
      EmbeddingsBlock.tools.config?.params?.({
        provider: 'openrouter',
        model: 'openrouter/qwen/qwen3-embedding-8b',
        input: 'hello',
        apiKey: 'stale-openai-key',
        openRouterApiKey: 'or-test',
        dimensions: '1024',
      })
    ).toEqual({
      apiKey: 'or-test',
      input: 'hello',
      model: 'openrouter/qwen/qwen3-embedding-8b',
      taskType: undefined,
      dimensions: undefined,
    })
  })

  it('requires the OpenRouter key on hosted and self-hosted deployments', () => {
    const keySubBlock = subBlocksById('openRouterApiKey')[0]
    expect(keySubBlock.required).toBe(true)
    expect(keySubBlock.hideWhenHosted).toBeUndefined()
    expect(keySubBlock.placeholder).not.toContain('OPENROUTER_API_KEY')
    expect(() =>
      EmbeddingsBlock.tools.config?.params?.({
        provider: 'openrouter',
        model: DEFAULT_OPENROUTER_EMBEDDING_MODEL,
        input: 'hello',
      })
    ).toThrow('OpenRouter API key is required')
  })

  it('only forwards capabilities the selected model declares', () => {
    const params = EmbeddingsBlock.tools.config?.params

    // ada-002 has neither task types nor reducible dimensions, so both are dropped
    // even when stale sub-block values linger in a saved workflow.
    expect(
      params?.({
        provider: 'openai',
        model: 'text-embedding-ada-002',
        input: 'hello',
        apiKey: 'k',
        taskType: 'query',
        dimensions: '256',
      })
    ).toEqual({ apiKey: 'k', input: 'hello', model: 'text-embedding-ada-002' })

    // gemini declares both, so both are forwarded — dimensions coerced to a number.
    expect(
      params?.({
        provider: 'gemini',
        model: 'gemini-embedding-001',
        input: 'hello',
        apiKey: 'k',
        taskType: 'query',
        dimensions: '768',
      })
    ).toEqual({
      apiKey: 'k',
      input: 'hello',
      model: 'gemini-embedding-001',
      taskType: 'query',
      dimensions: 768,
    })
  })

  /**
   * Every per-model Dimensions dropdown shares the `dimensions` id and nothing
   * clears a stored subblock value when its `dependsOn` fields change, so a
   * reduction chosen for one model outlives a switch to another.
   */
  /**
   * The generic handler merges this result over the original inputs
   * (`{ ...inputs, ...transformedParams }`), so omitting a stale key leaves the
   * old value in place. Only an explicit `undefined` overrides it — asserting
   * the merged result is what actually pins the behavior.
   */
  describe('stale values are overridden, not merely omitted', () => {
    const mergeLikeExecutor = (inputs: Record<string, unknown>) => ({
      ...inputs,
      ...EmbeddingsBlock.tools.config?.params?.(inputs),
    })

    it('overrides a dimension the selected model does not offer', () => {
      const merged = mergeLikeExecutor({
        provider: 'openai',
        model: 'text-embedding-3-small',
        input: 'hello',
        apiKey: 'k',
        dimensions: '3072',
      })

      expect(merged.dimensions).toBeUndefined()
    })

    it('overrides a task type the selected model does not offer', () => {
      const merged = mergeLikeExecutor({
        provider: 'openai',
        model: 'text-embedding-3-small',
        input: 'hello',
        apiKey: 'k',
        taskType: 'similarity',
      })

      expect(merged.taskType).toBeUndefined()
    })

    it('replaces a model left over from a previous provider', () => {
      // Selecting Cohere with OpenAI's model still stored must not reach the
      // route, which rejects it as a provider mismatch.
      const merged = mergeLikeExecutor({
        provider: 'cohere',
        model: 'text-embedding-3-large',
        input: 'hello',
        apiKey: 'k',
      })

      expect(merged.model).toBe('embed-v4.0')
    })

    it('replaces a catalog model left over when switching to OpenRouter', () => {
      const merged = mergeLikeExecutor({
        provider: 'openrouter',
        model: 'gemini-embedding-001',
        input: 'hello',
        openRouterApiKey: 'or-test',
      })

      expect(merged.model).toBe(DEFAULT_OPENROUTER_EMBEDDING_MODEL)
    })

    it('rejects an invalid model entered for OpenRouter', () => {
      expect(() =>
        mergeLikeExecutor({
          provider: 'openrouter',
          model: 'not-an-openrouter-model',
          input: 'hello',
          openRouterApiKey: 'or-test',
        })
      ).toThrow('Invalid OpenRouter embedding model: not-an-openrouter-model')
    })

    it('keeps a model that does belong to the selected provider', () => {
      const merged = mergeLikeExecutor({
        provider: 'openai',
        model: 'text-embedding-3-large',
        input: 'hello',
        apiKey: 'k',
      })

      expect(merged.model).toBe('text-embedding-3-large')
    })
  })

  it('drops a dimension the newly selected model no longer offers', () => {
    const params = EmbeddingsBlock.tools.config?.params

    // 3072 is valid for text-embedding-3-large but not for -3-small.
    expect(
      params?.({
        provider: 'openai',
        model: 'text-embedding-3-small',
        input: 'hello',
        apiKey: 'k',
        dimensions: '3072',
      })
    ).toEqual({ apiKey: 'k', input: 'hello', model: 'text-embedding-3-small' })

    // A model with no reduction support never forwards one.
    expect(
      params?.({
        provider: 'mistral',
        model: 'mistral-embed',
        input: 'hello',
        apiKey: 'k',
        dimensions: '512',
      })
    ).toEqual({ apiKey: 'k', input: 'hello', model: 'mistral-embed' })
  })

  it('drops a task type the newly selected model no longer offers', () => {
    const params = EmbeddingsBlock.tools.config?.params

    // Gemini supports 'similarity'; Cohere does not.
    expect(
      params?.({
        provider: 'cohere',
        model: 'embed-v4.0',
        input: 'hello',
        apiKey: 'k',
        taskType: 'similarity',
      })
    ).toEqual({ apiKey: 'k', input: 'hello', model: 'embed-v4.0' })

    // A model with no task conditioning never forwards one.
    expect(
      params?.({
        provider: 'openai',
        model: 'text-embedding-3-small',
        input: 'hello',
        apiKey: 'k',
        taskType: 'query',
      })
    ).toEqual({ apiKey: 'k', input: 'hello', model: 'text-embedding-3-small' })
  })

  it('requires input text', () => {
    expect(() =>
      EmbeddingsBlock.tools.config?.params?.({ provider: 'openai', apiKey: 'k' })
    ).toThrow('Input text is required')
  })
})

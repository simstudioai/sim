/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { EMBEDDING_MODELS } from '@/lib/embeddings/catalog'
import {
  DEFAULT_MODEL_BY_PROVIDER,
  EmbeddingsBlock,
  TOOL_ID_BY_PROVIDER,
} from '@/blocks/blocks/embeddings'

/**
 * The block spells its model, task-type, and dimension options out as literals
 * because `scripts/generate-docs.ts` parses the block file as source text and
 * cannot see computed values. These tests are what stop those literals from
 * drifting away from the catalog that actually drives the runtime.
 */

function subBlocksById(id: string) {
  return EmbeddingsBlock.subBlocks.filter((sb) => sb.id === id)
}

function optionIds(options: unknown): string[] {
  return Array.isArray(options) ? options.map((option) => (option as { id: string }).id) : []
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
  it('offers exactly the catalog models for each provider', () => {
    const modelSubBlocks = subBlocksById('model')
    const offered = new Map<string, string[]>()

    for (const subBlock of modelSubBlocks) {
      const provider = conditionProvider(subBlock)
      expect(provider).toBeDefined()
      offered.set(provider as string, optionIds(subBlock.options))
    }

    const expected = new Map<string, string[]>()
    for (const [modelId, info] of Object.entries(EMBEDDING_MODELS)) {
      expected.set(info.provider, [...(expected.get(info.provider) ?? []), modelId])
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
    const withTaskTypes = Object.entries(EMBEDDING_MODELS)
      .filter(([, info]) => info.supportedTaskTypes)
      .map(([id]) => id)

    const subBlocks = subBlocksById('taskType')
    expect(subBlocks.map(conditionModel).sort()).toEqual(withTaskTypes.slice().sort())

    for (const subBlock of subBlocks) {
      const model = conditionModel(subBlock) as string
      expect(optionIds(subBlock.options)).toEqual([
        ...(EMBEDDING_MODELS[model].supportedTaskTypes ?? []),
      ])
    }
  })

  it('shows a dimensions dropdown for exactly the models that support reduction', () => {
    const withDimensions = Object.entries(EMBEDDING_MODELS)
      .filter(([, info]) => info.supportedDimensions)
      .map(([id]) => id)

    const subBlocks = subBlocksById('dimensions')
    expect(subBlocks.map(conditionModel).sort()).toEqual(withDimensions.slice().sort())

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

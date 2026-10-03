import { describe, expect, it } from 'vitest'
import { EmbeddingsBlock } from '@/blocks/blocks/embeddings'

/**
 * The block derives its model, task-type, and dimension options from the
 * catalog, so these assert the derivation still produces what the UI expects:
 * one dropdown per provider/model, the catalog's own option sets, and the
 * native size pre-selected. They also pin the provider-to-tool routing.
 */

describe('Embeddings block', () => {
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

  describe('Ollama', () => {
    it('forwards the bare model name and drops every credential-bearing field', () => {
      expect(
        EmbeddingsBlock.tools.config?.params?.({
          provider: 'ollama',
          model: 'nomic-embed-text:latest',
          input: 'hello',
          apiKey: 'stale-key',
          taskType: 'query',
          dimensions: '768',
        })
      ).toEqual({
        input: 'hello',
        model: 'nomic-embed-text:latest',
        taskType: undefined,
        dimensions: undefined,
      })
    })
  })
})

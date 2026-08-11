/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { embeddingsCohereTool } from '@/tools/embeddings/cohere'
import { embeddingsGeminiTool } from '@/tools/embeddings/gemini'
import { embeddingsMistralTool } from '@/tools/embeddings/mistral'
import { embeddingsOpenAITool } from '@/tools/embeddings/openai'
import { embeddingsOpenRouterTool } from '@/tools/embeddings/openrouter'
import { embeddingsTool as legacyOpenAIEmbeddingsTool } from '@/tools/openai/embeddings'

const ALL_TOOLS = [
  embeddingsOpenAITool,
  embeddingsGeminiTool,
  embeddingsCohereTool,
  embeddingsMistralTool,
  embeddingsOpenRouterTool,
  legacyOpenAIEmbeddingsTool,
]

/**
 * `input` is the only param that leaves as model-visible content. Without a
 * `modelInput` declaration the projection layer fails open — a secret
 * interpolated into the input would reach the provider as plaintext — so every
 * tool built from the factory, including the legacy alias, must declare it.
 */
describe('embeddings tools model-input projection', () => {
  it('declares a projecting model input on every tool', () => {
    for (const tool of ALL_TOOLS) {
      expect(tool.request.modelInput?.mode, `${tool.id} must project its model input`).toBe(
        'project'
      )
    }
  })

  it('selects only the input field, never the API key', () => {
    for (const tool of ALL_TOOLS) {
      const modelInput = tool.request.modelInput
      if (modelInput?.mode !== 'project') throw new Error(`${tool.id} does not project`)

      expect(
        modelInput.select({
          input: 'embed me',
          apiKey: 'sk-secret',
          model: 'text-embedding-3-small',
        } as never)
      ).toEqual({ input: 'embed me' })
    }
  })

  /**
   * The projection traverser recurses element-wise through arrays, so an array
   * input needs no special selector — but the selected key must survive
   * unchanged, since the block accepts both a string and a list of strings.
   */
  it('selects an array input unchanged', () => {
    const modelInput = embeddingsOpenAITool.request.modelInput
    if (modelInput?.mode !== 'project') throw new Error('expected a projecting model input')

    expect(modelInput.select({ input: ['alpha', 'beta'], apiKey: 'sk-secret' } as never)).toEqual({
      input: ['alpha', 'beta'],
    })
  })

  /**
   * Every selected key must exist in `tool.params` or the projection layer
   * rejects the selection and the call fails closed.
   */
  it('selects only keys the tool declares as params', () => {
    for (const tool of ALL_TOOLS) {
      const modelInput = tool.request.modelInput
      if (modelInput?.mode !== 'project') throw new Error(`${tool.id} does not project`)

      for (const key of Object.keys(modelInput.select({ input: 'x' } as never))) {
        expect(Object.hasOwn(tool.params, key), `${tool.id}.params must declare "${key}"`).toBe(
          true
        )
      }
    }
  })

  it('requires an explicit OpenRouter key without hosted-key injection', () => {
    expect(embeddingsOpenRouterTool.params.apiKey.required).toBe(true)
    expect(embeddingsOpenRouterTool.hosting).toBeUndefined()
    expect(embeddingsOpenRouterTool.request.body({ input: 'hello' } as never)).toMatchObject({
      provider: 'openrouter',
      model: 'openrouter/openai/text-embedding-3-small',
    })
  })
})

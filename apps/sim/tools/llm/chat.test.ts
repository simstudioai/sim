import { describe, expect, it } from 'vitest'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import { llmChatTool } from '@/tools/llm/chat'
import { projectToolModelInputParams } from '@/tools/request-transport'

describe('llmChatTool.operation', () => {
  it('projects active prompt secrets before materializing provider input', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'PROMPT_SECRET', plaintext: 'secret-value', encryptedValue: 'encrypted-value' },
    ])
    registry.recordResolvedAtInputPath('PROMPT_SECRET', 'secret-value', ['context'])
    registry.recordResolvedInputProjection(['context'], 'secret-value', '{{PROMPT_SECRET}}')
    const params = {
      model: 'gpt-4o',
      systemPrompt: 'ordinary system prompt',
      context: 'secret-value',
      apiKey: 'credential',
    }

    const projected = projectToolModelInputParams(llmChatTool, params, registry)
    const input = llmChatTool.operation.input(projected) as Record<string, unknown>

    expect(input.systemPrompt).toBe('ordinary system prompt')
    expect(JSON.parse(input.context as string)).toEqual([
      { role: 'user', content: '{{PROMPT_SECRET}}' },
    ])
    expect(input.apiKey).toBe('credential')
    expect(params.context).toBe('secret-value')
  })

  it('refuses sim-auto, which only the model router resolves, rather than calling Ollama', () => {
    expect(() =>
      llmChatTool.operation.input({
        model: 'sim-auto',
        systemPrompt: 'Translate to French',
        context: 'hello',
      })
    ).toThrow('sim-auto has no provider until the model router resolves it')
  })

  it.each(['gpt-oss:20b', 'mistral:latest', 'claude-local:7b', 'gemini-tuned/chat:q4_k_m'])(
    'sends a locally installed Ollama model that shares a cloud prefix to Ollama: %s',
    (model) => {
      const input = llmChatTool.operation.input({
        model,
        systemPrompt: 'Translate to French',
        context: 'hello',
      }) as Record<string, unknown>

      expect(input.provider).toBe('ollama')
      expect(input.model).toBe(model)
    }
  )
})

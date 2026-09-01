/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import { llmChatTool } from '@/tools/llm/chat'
import { projectToolModelInputParams } from '@/tools/request-transport'

describe('llmChatTool.operation', () => {
  it('selects only prompt fields for exact model-facing projection', () => {
    const modelInput = llmChatTool.operation.modelInput
    expect(modelInput?.mode).toBe('project')
    if (modelInput?.mode !== 'project') throw new Error('Unexpected model input mode')

    expect(
      modelInput.select({
        model: 'gpt-4o',
        systemPrompt: 'system',
        context: 'user',
        apiKey: 'credential',
      })
    ).toEqual({ systemPrompt: 'system', context: 'user' })
  })

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

  it('materializes provider input without HTTP metadata or caller-supplied scope', () => {
    const input = llmChatTool.operation.input({
      model: 'gpt-4o',
      systemPrompt: 'legacy system prompt',
      context: 'legacy context',
      apiKey: 'credential',
      _context: { workspaceId: 'untrusted-workspace', workflowId: 'untrusted-workflow' },
    }) as Record<string, unknown>

    expect(input).toMatchObject({
      systemPrompt: 'legacy system prompt',
      context: JSON.stringify([{ role: 'user', content: 'legacy context' }]),
    })
    expect(input).not.toHaveProperty('workspaceId')
    expect(input).not.toHaveProperty('workflowId')
    expect(llmChatTool).not.toHaveProperty('request')
  })
})

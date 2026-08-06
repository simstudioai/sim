/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { llmChatTool } from '@/tools/llm/chat'

describe('llmChatTool.request.modelInput', () => {
  it('delegates exact model-bound input provenance to the authenticated provider route', () => {
    const modelInput = llmChatTool.request.modelInput
    expect(modelInput?.mode).toBe('private-provenance')
    if (modelInput?.mode !== 'private-provenance') throw new Error('Unexpected model input mode')

    expect(
      modelInput.select({
        model: 'gpt-4o',
        systemPrompt: 'system',
        context: 'user',
        apiKey: 'credential',
      })
    ).toEqual(['system', 'user'])
  })
})

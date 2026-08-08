/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  PRIVATE_MODEL_INPUT_PROVENANCE_HEADER,
  PRIVATE_MODEL_INPUT_STATE_HEADER,
  PROJECTED_MODEL_INPUT_PATHS_V1,
} from '@/lib/execution/model-input-provenance'
import {
  RESOLVED_SECRET_PROVENANCE_FIELD,
  RESOLVED_SECRET_PROVENANCE_METADATA_V1,
} from '@/lib/execution/private-tool-metadata'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import { llmChatTool } from '@/tools/llm/chat'
import { prepareToolRequest } from '@/tools/request-transport'

describe('llmChatTool.request.modelInput', () => {
  it('selects only prompt fields for exact model-facing projection', () => {
    const modelInput = llmChatTool.request.modelInput
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

  it('projects active prompt secrets before the provider route while preserving raw params', () => {
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

    const request = prepareToolRequest(llmChatTool, params, registry)
    const body = JSON.parse(request.body ?? '{}')

    expect(body.systemPrompt).toBe('ordinary system prompt')
    expect(JSON.parse(body.context)).toEqual([{ role: 'user', content: '{{PROMPT_SECRET}}' }])
    expect(body.apiKey).toBe('credential')
    expect(request.headers.get(PRIVATE_MODEL_INPUT_PROVENANCE_HEADER)).toBe(
      RESOLVED_SECRET_PROVENANCE_METADATA_V1
    )
    expect(request.headers.get(PRIVATE_MODEL_INPUT_STATE_HEADER)).toBe(
      PROJECTED_MODEL_INPUT_PATHS_V1
    )
    expect(body[RESOLVED_SECRET_PROVENANCE_FIELD]).toEqual(
      expect.objectContaining({ version: 1, complete: true })
    )
    expect(params.context).toBe('secret-value')
  })

  it('preserves the headerless legacy request when no registry is available', () => {
    const request = prepareToolRequest(llmChatTool, {
      model: 'gpt-4o',
      systemPrompt: 'legacy system prompt',
      context: 'legacy context',
      apiKey: 'credential',
    })

    expect(request.headers.has(PRIVATE_MODEL_INPUT_PROVENANCE_HEADER)).toBe(false)
    expect(request.headers.has(PRIVATE_MODEL_INPUT_STATE_HEADER)).toBe(false)
    expect(JSON.parse(request.body ?? '{}')).toEqual(
      expect.objectContaining({
        systemPrompt: 'legacy system prompt',
        context: JSON.stringify([{ role: 'user', content: 'legacy context' }]),
      })
    )
  })
})

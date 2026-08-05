/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { collectProviderModelInputProvenanceValues } from '@/providers/model-input-provenance'
import type { ProviderRequest } from '@/providers/types'

function request(overrides: Partial<ProviderRequest> = {}): ProviderRequest {
  return {
    model: 'test-model',
    systemPrompt: 'public prompt',
    ...overrides,
  }
}

describe('provider model input provenance', () => {
  it('selects dynamic model content without transport context or validated schema grammar', () => {
    const selected = collectProviderModelInputProvenanceValues(
      request({
        apiKey: 'transport-key',
        environmentVariables: { UNUSED: 'unused-secret' },
        tools: [
          {
            id: 'dynamic-id',
            name: 'dynamic-name',
            description: 'dynamic description',
            params: {},
            parameters: {
              type: 'object',
              properties: {
                dynamicField: { type: 'string', description: 'dynamic field description' },
              },
              required: ['dynamicField'],
            },
          },
        ],
      }),
      'openai'
    )

    expect(JSON.stringify(selected)).toContain('dynamic description')
    expect(JSON.stringify(selected)).toContain('dynamicField')
    expect(JSON.stringify(selected)).toContain('dynamic field description')
    expect(JSON.stringify(selected)).not.toContain('transport-key')
    expect(JSON.stringify(selected)).not.toContain('unused-secret')
  })

  it('selects only attachment names that the target provider transmits', () => {
    const documentRequest = request({
      messages: [
        {
          role: 'user',
          content: 'read this',
          files: [
            {
              id: 'file-1',
              name: 'model-visible-name.txt',
              url: '/file',
              size: 1,
              type: 'text/plain',
              key: 'workspace/file-1',
              context: 'storage-only-context',
            },
          ],
        },
      ],
    })
    const openAISelected = collectProviderModelInputProvenanceValues(documentRequest, 'openai')
    const geminiSelected = collectProviderModelInputProvenanceValues(documentRequest, 'google')
    const imageSelected = collectProviderModelInputProvenanceValues(
      request({
        messages: [
          {
            role: 'user',
            content: 'view this',
            files: [
              {
                id: 'image-1',
                name: 'non-model-image-name.png',
                url: '/image',
                size: 1,
                type: 'image/png',
              },
            ],
          },
        ],
      }),
      'openai'
    )

    expect(openAISelected).toContain('model-visible-name.txt')
    expect(openAISelected).not.toContain('storage-only-context')
    expect(geminiSelected).not.toContain('model-visible-name.txt')
    expect(imageSelected).not.toContain('non-model-image-name.png')
  })

  it('omits every candidate from optional schemas the provider boundary will drop', () => {
    const selected = collectProviderModelInputProvenanceValues(
      request({
        tools: [
          {
            id: 'malformed-tool-id',
            name: 'malformed-tool-name',
            description: 'malformed-tool-description',
            params: {},
            parameters: { properties: { field: 'not-a-schema' } },
          },
        ],
        responseFormat: {
          name: 'malformed-response-name',
          schema: { allOf: ['not-a-schema'] },
        },
      }),
      'openai'
    )

    expect(JSON.stringify(selected)).not.toContain('malformed-tool')
    expect(JSON.stringify(selected)).not.toContain('malformed-response')
  })

  it('rejects an oversized model-input selection before building an unbounded projection', () => {
    const messages = Array.from({ length: 50_001 }, () => ({
      role: 'user' as const,
      content: 'public',
    }))

    expect(() =>
      collectProviderModelInputProvenanceValues(request({ messages }), 'openai')
    ).toThrow('Provider model input provenance selection exceeds its safe limit')
  })
})

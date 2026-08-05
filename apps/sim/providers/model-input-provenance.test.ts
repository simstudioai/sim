/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import {
  collectProviderModelInputProvenanceValues,
  reconstructLegacyProviderModelInputProvenance,
} from '@/providers/model-input-provenance'
import type { ProviderRequest } from '@/providers/types'

vi.mock('@/lib/core/security/encryption', () => ({
  decryptSecret: vi.fn(async (encryptedValue: string) => ({
    decrypted: encryptedValue === 'encrypted-active' ? 'secret-value' : 'string',
  })),
}))

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
      })
    )

    expect(JSON.stringify(selected)).toContain('dynamic description')
    expect(JSON.stringify(selected)).toContain('dynamicField')
    expect(JSON.stringify(selected)).toContain('dynamic field description')
    expect(JSON.stringify(selected)).not.toContain('transport-key')
    expect(JSON.stringify(selected)).not.toContain('unused-secret')
  })

  it('legacy reconstruction activates matching model content but not dormant schema controls', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      {
        name: 'ACTIVE',
        plaintext: 'secret-value',
        encryptedValue: 'encrypted-active',
      },
      {
        name: 'DORMANT_CONTROL',
        plaintext: 'string',
        encryptedValue: 'encrypted-control',
      },
    ])

    expect(
      await reconstructLegacyProviderModelInputProvenance(
        request({
          systemPrompt: 'use secret-value',
          responseFormat: {
            name: 'response',
            schema: { type: 'string' },
            strict: true,
          },
        }),
        registry
      )
    ).toBe(true)
    expect(registry.exportProvenance().entries).toEqual([
      { encryptedValue: 'encrypted-active', name: 'ACTIVE' },
    ])
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
      })
    )

    expect(JSON.stringify(selected)).not.toContain('malformed-tool')
    expect(JSON.stringify(selected)).not.toContain('malformed-response')
  })

  it('rejects an oversized model-input selection before building an unbounded projection', () => {
    const messages = Array.from({ length: 50_001 }, () => ({
      role: 'user' as const,
      content: 'public',
    }))

    expect(() => collectProviderModelInputProvenanceValues(request({ messages }))).toThrow(
      'Provider model input provenance selection exceeds its safe limit'
    )
  })
})

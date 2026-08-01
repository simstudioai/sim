import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'
import { describe, expect, it } from 'vitest'
import { PI_MODEL_IDS_BY_PROVIDER } from '@/providers/pi-model-catalog.generated'
import { PI_PROVIDER_CONFIGS } from '@/providers/pi-provider-configs'
import { resolvePiModelId } from '@/providers/pi-providers'

describe('Pi provider catalog', () => {
  it('matches the model catalog in the pinned Pi package', () => {
    for (const { id, piProviderId } of PI_PROVIDER_CONFIGS) {
      expect([...PI_MODEL_IDS_BY_PROVIDER[id]].sort()).toEqual(
        getBuiltinModels(piProviderId)
          .map(({ id: modelId }) => modelId)
          .sort()
      )
    }
  })

  it('keeps exact provider-relative model IDs', () => {
    expect(resolvePiModelId('anthropic', 'claude-sonnet-4-6')).toBe('claude-sonnet-4-6')
  })

  it('normalizes Sim provider prefixes only when Pi declares the resulting ID', () => {
    expect(resolvePiModelId('groq', 'groq/openai/gpt-oss-120b')).toBe('openai/gpt-oss-120b')
    expect(resolvePiModelId('cerebras', 'cerebras/gpt-oss-120b')).toBe('gpt-oss-120b')
    expect(resolvePiModelId('groq', 'groq/unknown-model')).toBeUndefined()
  })

  it('maps Sim provider IDs onto Pi provider IDs', () => {
    expect(resolvePiModelId('kimi', 'kimi-k2.6')).toBe('kimi-k2.6')
    expect(resolvePiModelId('nvidia', 'nvidia/nemotron-3-super-120b-a12b')).toBe(
      'nvidia/nemotron-3-super-120b-a12b'
    )
  })

  it('rejects provider/model pairs absent from the installed Pi catalog', () => {
    expect(resolvePiModelId('anthropic', 'claude-sonnet-999')).toBeUndefined()
    expect(resolvePiModelId('unsupported', 'model')).toBeUndefined()
  })
})

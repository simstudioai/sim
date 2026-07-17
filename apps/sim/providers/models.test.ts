/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  getBaseModelProviders,
  getHostedModels,
  orderModelIdsByReleaseDate,
  PROVIDER_DEFINITIONS,
} from '@/providers/models'

/** Maps a lowercased model ID to its provider's index in the catalog. */
const PROVIDER_INDEX_BY_MODEL = new Map<string, number>()
/** Maps a lowercased model ID to its release time (ms), or null when undated. */
const RELEASE_TIME_BY_MODEL = new Map<string, number | null>()
for (const [providerIndex, provider] of Object.values(PROVIDER_DEFINITIONS).entries()) {
  for (const model of provider.models) {
    const id = model.id.toLowerCase()
    PROVIDER_INDEX_BY_MODEL.set(id, providerIndex)
    RELEASE_TIME_BY_MODEL.set(id, model.releaseDate ? Date.parse(model.releaseDate) : null)
  }
}

describe('orderModelIdsByReleaseDate', () => {
  it('keeps provider grouping order intact', () => {
    const ordered = orderModelIdsByReleaseDate(Object.keys(getBaseModelProviders()))
    let lastProviderIndex = -1
    const seenProviders = new Set<number>()
    for (const id of ordered) {
      const providerIndex = PROVIDER_INDEX_BY_MODEL.get(id.toLowerCase())
      expect(providerIndex).toBeDefined()
      // A provider's models must form one contiguous run: once we leave a provider
      // we never return to it.
      if (providerIndex !== lastProviderIndex) {
        expect(seenProviders.has(providerIndex as number)).toBe(false)
        seenProviders.add(providerIndex as number)
        lastProviderIndex = providerIndex as number
      }
    }
  })

  it('sorts models within a provider newest-first by release date', () => {
    const ordered = orderModelIdsByReleaseDate(Object.keys(getBaseModelProviders()))
    for (let i = 1; i < ordered.length; i++) {
      const prev = ordered[i - 1].toLowerCase()
      const curr = ordered[i].toLowerCase()
      if (PROVIDER_INDEX_BY_MODEL.get(prev) !== PROVIDER_INDEX_BY_MODEL.get(curr)) continue

      const prevTime = RELEASE_TIME_BY_MODEL.get(prev)
      const currTime = RELEASE_TIME_BY_MODEL.get(curr)
      // Dated models precede undated ones; among dated models, newer precedes older.
      if (prevTime == null) {
        expect(currTime).toBeNull()
      } else if (currTime != null) {
        expect(prevTime).toBeGreaterThanOrEqual(currTime)
      }
    }
  })

  it('preserves the cross-provider grouping order given in the input', () => {
    // Pick the first model of two different providers and feed the second provider
    // first; the helper must keep that provider's group ahead of the other.
    const byProvider = new Map<number, string[]>()
    for (const id of Object.keys(getBaseModelProviders())) {
      const providerIndex = PROVIDER_INDEX_BY_MODEL.get(id.toLowerCase()) as number
      const bucket = byProvider.get(providerIndex) ?? []
      bucket.push(id)
      byProvider.set(providerIndex, bucket)
    }
    const providerIndexes = [...byProvider.keys()]
    expect(providerIndexes.length).toBeGreaterThanOrEqual(2)
    const [firstProvider, secondProvider] = providerIndexes
    const fromFirst = byProvider.get(firstProvider) as string[]
    const fromSecond = byProvider.get(secondProvider) as string[]

    // Input order intentionally leads with the second provider.
    const input = [fromSecond[0], fromFirst[0]]
    const ordered = orderModelIdsByReleaseDate(input)
    expect(PROVIDER_INDEX_BY_MODEL.get(ordered[0].toLowerCase())).toBe(secondProvider)
    expect(PROVIDER_INDEX_BY_MODEL.get(ordered[1].toLowerCase())).toBe(firstProvider)
  })

  it('places unknown model IDs last, preserving their input order', () => {
    const known = Object.keys(getBaseModelProviders())[0]
    const ordered = orderModelIdsByReleaseDate(['mystery-a', known, 'mystery-b'])
    expect(ordered[0]).toBe(known)
    expect(ordered.slice(1)).toEqual(['mystery-a', 'mystery-b'])
  })

  it('is case-insensitive when matching catalog IDs', () => {
    const id = Object.keys(getBaseModelProviders())[0]
    const ordered = orderModelIdsByReleaseDate([id.toUpperCase()])
    expect(ordered).toEqual([id.toUpperCase()])
  })

  it('returns an empty array for empty input', () => {
    expect(orderModelIdsByReleaseDate([])).toEqual([])
  })

  it('does not add or drop any IDs', () => {
    const input = Object.keys(getBaseModelProviders())
    const ordered = orderModelIdsByReleaseDate(input)
    expect([...ordered].sort()).toEqual([...input].sort())
  })
})

describe('sakana provider definition', () => {
  const sakana = PROVIDER_DEFINITIONS.sakana

  it('is registered with fugu as the default model', () => {
    expect(sakana).toBeDefined()
    expect(sakana.id).toBe('sakana')
    expect(sakana.defaultModel).toBe('fugu')
    expect(sakana.modelPatterns).toEqual([/^fugu/])
  })

  it('exposes fugu and fugu-ultra with a 1M context window', () => {
    expect(sakana.models.map((m) => m.id)).toEqual(['fugu', 'fugu-ultra'])
    for (const model of sakana.models) {
      expect(model.contextWindow).toBe(1000000)
    }
  })

  it('prices both models at the documented fugu-ultra ceiling', () => {
    for (const model of sakana.models) {
      expect(model.pricing.input).toBe(5)
      expect(model.pricing.output).toBe(30)
      expect(model.pricing.cachedInput).toBe(0.5)
    }
  })

  it('routes bare fugu model IDs to the sakana provider', () => {
    const baseModels = getBaseModelProviders()
    expect(baseModels.fugu).toBe('sakana')
    expect(baseModels['fugu-ultra']).toBe('sakana')
  })
})

describe('nvidia provider definition', () => {
  const nvidia = PROVIDER_DEFINITIONS.nvidia

  const expectedModels = [
    { id: 'nvidia/llama-3.1-nemotron-70b-instruct', contextWindow: 128000 },
    { id: 'nvidia/llama-3.1-nemotron-ultra-253b-v1', contextWindow: 131072 },
    { id: 'nvidia/llama-3.3-nemotron-super-49b-v1.5', contextWindow: 131072 },
    { id: 'nvidia/nemotron-3-nano-30b-a3b', contextWindow: 262144 },
    { id: 'nvidia/nemotron-3-super-120b-a12b', contextWindow: 1048576 },
    { id: 'nvidia/nemotron-3-ultra-550b-a55b', contextWindow: 1048576 },
  ]

  it('is registered with the current-gen Super model as the default', () => {
    expect(nvidia).toBeDefined()
    expect(nvidia.id).toBe('nvidia')
    expect(nvidia.defaultModel).toBe('nvidia/nemotron-3-super-120b-a12b')
    expect(nvidia.modelPatterns).toEqual([/^nvidia\//])
  })

  it('exposes all six Nemotron models with the documented context windows', () => {
    expect(nvidia.models.map((m) => m.id)).toEqual(expectedModels.map((m) => m.id))
    for (const expected of expectedModels) {
      const model = nvidia.models.find((m) => m.id === expected.id)
      expect(model?.contextWindow).toBe(expected.contextWindow)
    }
  })

  it('routes every nvidia model ID to the nvidia provider', () => {
    const baseModels = getBaseModelProviders()
    for (const expected of expectedModels) {
      expect(baseModels[expected.id]).toBe('nvidia')
    }
  })
})

describe('zai provider definition', () => {
  const zai = PROVIDER_DEFINITIONS.zai

  const expectedModels = [
    { id: 'glm-5.2', contextWindow: 1000000 },
    { id: 'glm-5.1', contextWindow: 200000 },
    { id: 'glm-5', contextWindow: 200000 },
    { id: 'glm-5-turbo', contextWindow: 200000 },
    { id: 'glm-4.7', contextWindow: 200000 },
    { id: 'glm-4.7-flashx', contextWindow: 200000 },
    { id: 'glm-4.6', contextWindow: 200000 },
    { id: 'glm-4.5', contextWindow: 128000 },
    { id: 'glm-4.5-air', contextWindow: 128000 },
    { id: 'glm-4.5-x', contextWindow: 128000 },
    { id: 'glm-4.5-airx', contextWindow: 128000 },
    { id: 'glm-4-32b-0414-128k', contextWindow: 128000 },
  ]

  it('is registered with a bare glm-4.6 as the default model', () => {
    expect(zai).toBeDefined()
    expect(zai.id).toBe('zai')
    expect(zai.defaultModel).toBe('glm-4.6')
    expect(zai.defaultModel.startsWith('zai/')).toBe(false)
    // No fallback pattern — an unscoped `/^glm/` would overmatch unrelated self-hosted
    // "glm-*" models and misroute them to Z.ai's hosted billing.
    expect(zai.modelPatterns).toEqual([])
  })

  it('exposes every GLM model with the documented context window', () => {
    expect(zai.models.map((m) => m.id)).toEqual(expectedModels.map((m) => m.id))
    for (const expected of expectedModels) {
      const model = zai.models.find((m) => m.id === expected.id)
      expect(model?.contextWindow).toBe(expected.contextWindow)
    }
  })

  it('routes every bare glm-* model ID to the zai provider', () => {
    const baseModels = getBaseModelProviders()
    for (const expected of expectedModels) {
      expect(baseModels[expected.id]).toBe('zai')
    }
  })

  it('is included in getHostedModels since Sim provides the Z.ai key server-side', () => {
    expect(getHostedModels()).toContain('glm-4.6')
  })
})

describe('kimi provider definition', () => {
  const kimi = PROVIDER_DEFINITIONS.kimi

  const expectedModels = [
    { id: 'kimi-k3', contextWindow: 1048576 },
    { id: 'kimi-k2.7-code', contextWindow: 262144 },
    { id: 'kimi-k2.7-code-highspeed', contextWindow: 262144 },
    { id: 'kimi-k2.6', contextWindow: 262144 },
  ]

  it('is registered with kimi-k2.6 as the default model', () => {
    expect(kimi).toBeDefined()
    expect(kimi.id).toBe('kimi')
    // kimi-k2.6 (not the flagship kimi-k3) — k3 access is tier-gated on Moonshot accounts,
    // and the default must be a model every account can serve.
    expect(kimi.defaultModel).toBe('kimi-k2.6')
    // No fallback pattern — an unscoped `/^kimi/` would overmatch Kimi weights re-hosted by
    // other providers and misroute them to Moonshot's hosted billing.
    expect(kimi.modelPatterns).toEqual([])
  })

  it('exposes every Kimi model with the documented context window', () => {
    expect(kimi.models.map((m) => m.id)).toEqual(expectedModels.map((m) => m.id))
    for (const expected of expectedModels) {
      const model = kimi.models.find((m) => m.id === expected.id)
      expect(model?.contextWindow).toBe(expected.contextWindow)
    }
  })

  it('declares no temperature capability since every current Kimi model pins it server-side', () => {
    expect(kimi.capabilities?.temperature).toBeUndefined()
    for (const model of kimi.models) {
      expect(model.capabilities.temperature).toBeUndefined()
    }
  })

  it('exposes the thinking toggle only on kimi-k2.6', () => {
    for (const model of kimi.models) {
      const hasToggle = model.id === 'kimi-k2.6'
      if (hasToggle) {
        expect(model.capabilities.thinking).toEqual({
          levels: ['disabled', 'enabled'],
          default: 'enabled',
        })
      } else {
        expect(model.capabilities.thinking).toBeUndefined()
      }
    }
  })

  it('routes every kimi model ID to the kimi provider', () => {
    const baseModels = getBaseModelProviders()
    for (const expected of expectedModels) {
      expect(baseModels[expected.id]).toBe('kimi')
    }
  })

  it('is included in getHostedModels since Sim provides the Kimi key server-side', () => {
    expect(getHostedModels()).toContain('kimi-k3')
  })
})

describe('xai provider definition', () => {
  const xai = PROVIDER_DEFINITIONS.xai

  it('is registered with grok-4.5 as the default model', () => {
    expect(xai).toBeDefined()
    expect(xai.id).toBe('xai')
    expect(xai.defaultModel).toBe('grok-4.5')
  })

  it('is included in getHostedModels since Sim provides the xAI key server-side', () => {
    expect(getHostedModels()).toContain('grok-4.5')
  })
})

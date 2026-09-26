import { describe, expect, it } from 'vitest'
import {
  findProviderFromModel,
  getBaseModelProviders,
  getHostedModels,
  getModelPricing,
  getProviderModels,
  getStaticProviderModels,
  isCustomModelId,
  isKnownModelId,
  isModelDeprecated,
  orderModelIdsByReleaseDate,
  PROVIDER_DEFINITIONS,
  updateFireworksModels,
  updateOllamaModels,
} from '@/providers/models'

describe('custom cloud model routing', () => {
  it.each([
    'ollama',
    'ollama-cloud',
    'vllm',
    'litellm',
    'openrouter',
    'fireworks',
    'together',
    'baseten',
  ] as const)(
    'accepts new model IDs in the %s namespace without accepting an empty ID',
    (provider) => {
      expect(findProviderFromModel(`${provider.toUpperCase()}/Org/CustomModel`)).toBe(provider)
      expect(isKnownModelId(`${provider}/Org/CustomModel`)).toBe(true)
      expect(isKnownModelId(`${provider}/`)).toBe(false)
      expect(isKnownModelId(`${provider}/ `)).toBe(false)
    }
  )

  it('keeps explicit provider namespaces authoritative over discovered local model names', () => {
    const originalModels = PROVIDER_DEFINITIONS.ollama.models
    try {
      updateOllamaModels([
        'azure/MyDeployment',
        'bedrock/CustomModel',
        'vertex/CustomModel',
        'openrouter/Org/CustomModel',
        'groq/Org/CustomModel',
        'cerebras/CustomModel',
      ])
      expect(findProviderFromModel('azure/MyDeployment')).toBe('azure-openai')
      expect(findProviderFromModel('bedrock/CustomModel')).toBe('bedrock')
      expect(findProviderFromModel('vertex/CustomModel')).toBe('vertex')
      expect(findProviderFromModel('openrouter/Org/CustomModel')).toBe('openrouter')
      expect(findProviderFromModel('groq/Org/CustomModel')).toBe('groq')
      expect(findProviderFromModel('cerebras/CustomModel')).toBe('cerebras')
    } finally {
      PROVIDER_DEFINITIONS.ollama.models = originalModels
    }
  })

  it.each([
    ['azure/MyDeployment', 'azure-openai'],
    ['AZURE/MyDeployment', 'azure-openai'],
    ['azure-anthropic/MyDeployment', 'azure-anthropic'],
    ['bedrock/custom-model:0', 'bedrock'],
    ['BEDROCK/custom-model:0', 'bedrock'],
    ['vertex/publishers/google/models/custom-gemini', 'vertex'],
    ['VERTEX/CustomModel', 'vertex'],
    ['GROQ/Org/CustomModel', 'groq'],
    ['CEREBRAS/CustomModel', 'cerebras'],
    ['NVIDIA/CustomModel', 'nvidia'],
  ])('routes %s without requiring a catalog entry', (model, provider) => {
    expect(findProviderFromModel(model)).toBe(provider)
    expect(isCustomModelId(model)).toBe(true)
    expect(isKnownModelId(model)).toBe(false)
    expect(getModelPricing(model)).toBeNull()
    expect(getHostedModels()).not.toContain(model)
  })

  it.each([
    'azure/',
    'azure/ ',
    'azure-anthropic/',
    'bedrock/',
    'vertex/',
    'groq/',
    'cerebras/',
    'nvidia/',
    'unknown/model',
    'gpt-100/model',
    'mistral/model',
  ])('does not accept an empty or unrecognized namespace as a custom model: %s', (model) => {
    expect(isCustomModelId(model)).toBe(false)
  })

  it('keeps catalog name typos distinct from custom reseller IDs', () => {
    expect(isCustomModelId('claude-sonnet-4.6')).toBe(false)
    expect(isCustomModelId('gpt-100-ultra')).toBe(false)
  })
})

describe('catalog featured model metadata', () => {
  it('defines at most one active featured model per provider', () => {
    for (const provider of Object.values(PROVIDER_DEFINITIONS)) {
      const featuredModels = provider.models.filter((model) => model.featured)

      expect(featuredModels.length).toBeLessThanOrEqual(1)
      expect(featuredModels.every((model) => model.sunset === undefined)).toBe(true)
    }
  })
})

const DYNAMIC_PROVIDERS = new Set([
  'ollama',
  'ollama-cloud',
  'vllm',
  'litellm',
  'openrouter',
  'fireworks',
  'together',
  'baseten',
])

function firstDeprecatedModelId(): string | undefined {
  for (const [providerId, provider] of Object.entries(PROVIDER_DEFINITIONS)) {
    if (DYNAMIC_PROVIDERS.has(providerId)) continue
    const dep = provider.models.find((m) => m.sunset)
    if (dep) return dep.id
  }
  return undefined
}

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

  it('routes bare fugu model IDs to the sakana provider', () => {
    const baseModels = getBaseModelProviders()
    expect(baseModels.fugu).toBe('sakana')
    expect(baseModels['fugu-ultra']).toBe('sakana')
    expect(baseModels['fugu-max-v1.0']).toBe('sakana')
    expect(baseModels['sakana-namazu-v1.0']).toBe('sakana')
  })
})

describe('nvidia provider definition', () => {
  const nvidia = PROVIDER_DEFINITIONS.nvidia

  const expectedModels = [
    { id: 'nvidia/nemotron-3.5-lightning-30b-a3b', contextWindow: 1000000 },
    { id: 'nvidia/llama-3.1-nemotron-70b-instruct', contextWindow: 128000 },
    { id: 'nvidia/llama-3.1-nemotron-ultra-253b-v1', contextWindow: 131072 },
    { id: 'nvidia/llama-3.3-nemotron-super-49b-v1.5', contextWindow: 131072 },
    { id: 'nvidia/nemotron-3-nano-30b-a3b', contextWindow: 262144 },
    { id: 'nvidia/nemotron-3-super-120b-a12b', contextWindow: 1048576 },
    { id: 'nvidia/nemotron-3-ultra-550b-a55b', contextWindow: 1048576 },
  ]

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
    { id: 'glm-5.3', contextWindow: 1000000 },
    { id: 'glm-5.3-flash', contextWindow: 1000000 },
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

  it('routes every bare glm-* model ID to the zai provider', () => {
    const baseModels = getBaseModelProviders()
    for (const expected of expectedModels) {
      expect(baseModels[expected.id]).toBe('zai')
    }
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

  it('routes every kimi model ID to the kimi provider', () => {
    const baseModels = getBaseModelProviders()
    for (const expected of expectedModels) {
      expect(baseModels[expected.id]).toBe('kimi')
    }
  })
})

describe('fireworks static catalog (the sim-auto pool)', () => {
  const poolModels = ['fireworks/glm-5.2', 'fireworks/kimi-k3']

  it('prices every pool model so hosted usage is billable', () => {
    for (const model of poolModels) {
      const pricing = getModelPricing(model)
      expect(pricing?.input).toBeGreaterThan(0)
      expect(pricing?.output).toBeGreaterThan(0)
    }
  })

  it('survives a dynamic model sync, which merges rather than replaces', () => {
    updateFireworksModels(['fireworks/accounts/acme/models/custom'])

    for (const model of poolModels) {
      expect(getHostedModels()).toContain(model)
      expect(getModelPricing(model)?.input).toBeGreaterThan(0)
    }
    expect(getProviderModels('fireworks')).toContain('fireworks/accounts/acme/models/custom')
  })

  it('does not duplicate a pool model the dynamic listing also returns', () => {
    updateFireworksModels(['fireworks/glm-5.2'])

    expect(getProviderModels('fireworks').filter((id) => id === 'fireworks/glm-5.2')).toHaveLength(
      1
    )
    expect(getModelPricing('fireworks/glm-5.2')?.input).toBeGreaterThan(0)
  })
})

describe('getStaticProviderModels', () => {
  it('retains public built-in models after private models are discovered', () => {
    const originalModels = PROVIDER_DEFINITIONS.fireworks.models
    const publicModels = getStaticProviderModels('fireworks')
    try {
      updateFireworksModels(['fireworks/private-test-model'])

      expect(publicModels.length).toBeGreaterThan(0)
      expect(getProviderModels('fireworks')).toContain('fireworks/private-test-model')
      expect(getStaticProviderModels('fireworks')).toEqual(publicModels)
    } finally {
      PROVIDER_DEFINITIONS.fireworks.models = originalModels
    }
  })

  it("excludes discovered names even when they match another provider's public model", () => {
    const originalModels = PROVIDER_DEFINITIONS.ollama.models
    try {
      updateOllamaModels(['private-local-model', 'fireworks/glm-5.2'])

      expect(getStaticProviderModels('ollama')).toEqual([])
    } finally {
      PROVIDER_DEFINITIONS.ollama.models = originalModels
    }
  })

  it('returns no models for an unknown provider', () => {
    expect(getStaticProviderModels('unknown-provider')).toEqual([])
  })
})

describe('isModelDeprecated', () => {
  it('returns true for a catalogued deprecated model (case-insensitive)', () => {
    const id = firstDeprecatedModelId()
    expect(id).toBeDefined()
    expect(isModelDeprecated(id!)).toBe(true)
    expect(isModelDeprecated(id!.toUpperCase())).toBe(true)
  })

  it('returns false for the default model of every provider', () => {
    for (const provider of Object.values(PROVIDER_DEFINITIONS)) {
      if (provider.defaultModel) expect(isModelDeprecated(provider.defaultModel)).toBe(false)
    }
  })

  it('returns false for empty, unknown, and dynamic-provider ids', () => {
    expect(isModelDeprecated('')).toBe(false)
    expect(isModelDeprecated(undefined)).toBe(false)
    expect(isModelDeprecated(null)).toBe(false)
    expect(isModelDeprecated('not-a-real-model')).toBe(false)
    expect(isModelDeprecated('openrouter/some/model')).toBe(false)
  })
})

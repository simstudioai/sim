/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  getBaseModelProviders,
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

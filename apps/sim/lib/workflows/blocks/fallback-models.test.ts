/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockShouldRequireApiKey, mockRequiresFamilyCredentials } = vi.hoisted(() => ({
  mockShouldRequireApiKey: vi.fn((model: string) => false),
  mockRequiresFamilyCredentials: vi.fn((model: string) => false),
}))

vi.mock('@/blocks/utils', () => ({
  shouldRequireApiKeyForModel: mockShouldRequireApiKey,
  requiresProviderFamilyCredentials: mockRequiresFamilyCredentials,
}))

vi.mock('@/providers/models', () => ({
  isAutoModel: (model: string) => model.trim().toLowerCase() === 'sim-auto',
  isKnownModelId: (model: string) => model.startsWith('gpt') || model.startsWith('claude'),
  findProviderFromModel: (model: string) => {
    const lower = model.toLowerCase()
    if (lower.startsWith('gpt')) return 'openai'
    if (lower.startsWith('claude')) return 'anthropic'
    if (lower.startsWith('vertex/')) return 'vertex'
    if (lower.startsWith('openrouter/')) return 'openrouter'
    return null
  },
  getReasoningEffortValuesForModel: (model: string) =>
    model === 'gpt-big'
      ? ['low', 'medium', 'high', 'xhigh']
      : model === 'gpt-small'
        ? ['low', 'high']
        : null,
  getThinkingLevelsForModel: (model: string) =>
    model.startsWith('claude') ? ['low', 'medium', 'high'] : null,
  getVerbosityValuesForModel: (model: string) =>
    model.startsWith('gpt') ? ['low', 'medium', 'high'] : null,
  getMaxTemperature: (model: string) =>
    model.startsWith('claude') ? 1 : model.startsWith('gpt') ? 2 : undefined,
  getModelCapabilities: (model: string) =>
    model === 'gpt-small'
      ? { maxOutputTokens: 4096 }
      : model.startsWith('gpt')
        ? { maxOutputTokens: 16000 }
        : model.startsWith('claude')
          ? {}
          : null,
}))

import {
  addFallbackRow,
  changeFallbackRowApiKey,
  changeFallbackRowModel,
  changeFallbackRowTuning,
  fallbackRowNeedsApiKey,
  getFallbackTuningKnobsToShow,
  getTuningOptionsForModel,
  isTuningValueValidForModel,
  isViableFallbackModel,
  isWholeEnvVarReference,
  MAX_FALLBACK_MODELS,
  moveFallbackRow,
  normalizeFallbackModels,
  normalizeTuningValues,
  ordinalChoiceLabel,
  removeFallbackRow,
  resolveFallbackTuning,
} from '@/lib/workflows/blocks/fallback-models'

beforeEach(() => {
  vi.clearAllMocks()
  mockShouldRequireApiKey.mockReturnValue(false)
  mockRequiresFamilyCredentials.mockReturnValue(false)
})

describe('isWholeEnvVarReference', () => {
  it('accepts exactly one braced variable name', () => {
    expect(isWholeEnvVarReference('{{OPENROUTER_API_KEY}}')).toBe(true)
    expect(isWholeEnvVarReference('{{ key_1 }}')).toBe(true)
  })

  it('refuses raw keys, partial references, and non-strings', () => {
    expect(isWholeEnvVarReference('sk-live-abc')).toBe(false)
    expect(isWholeEnvVarReference('prefix {{KEY}}')).toBe(false)
    expect(isWholeEnvVarReference('{{A}}{{B}}')).toBe(false)
    expect(isWholeEnvVarReference('{{1BAD}}')).toBe(false)
    expect(isWholeEnvVarReference(42)).toBe(false)
    expect(isWholeEnvVarReference(null)).toBe(false)
  })
})

describe('normalizeFallbackModels', () => {
  it('returns an empty chain for anything that is not an array', () => {
    expect(normalizeFallbackModels(undefined)).toEqual([])
    expect(normalizeFallbackModels('gpt-5')).toEqual([])
    expect(normalizeFallbackModels({ model: 'gpt-5' })).toEqual([])
  })

  it('keeps order, trims, and drops rows without a model', () => {
    expect(
      normalizeFallbackModels([
        { id: 'a', model: ' gpt-5 ' },
        { id: 'b', model: '' },
        { id: 'c' },
        null,
        { id: 'd', model: 'claude-sonnet-5' },
      ])
    ).toEqual([{ model: 'gpt-5' }, { model: 'claude-sonnet-5' }])
  })

  it('drops sim-auto and case-insensitive duplicates, keeping the first position', () => {
    expect(
      normalizeFallbackModels([
        { model: 'sim-auto' },
        { model: 'gpt-5' },
        { model: 'GPT-5' },
        { model: 'claude-sonnet-5' },
      ])
    ).toEqual([{ model: 'gpt-5' }, { model: 'claude-sonnet-5' }])
  })

  it('keeps a row tuning value, trimmed and lower-cased', () => {
    expect(
      normalizeFallbackModels([{ model: 'gpt-small', reasoningEffort: ' Low ', thinkingLevel: '' }])
    ).toEqual([{ model: 'gpt-small', reasoningEffort: 'low' }])
  })

  it('keeps any non-empty key, reference or already resolved, and drops blanks', () => {
    expect(
      normalizeFallbackModels([
        { model: 'openrouter/a', apiKey: '{{OPENROUTER_API_KEY}}' },
        { model: 'openrouter/b', apiKey: ' sk-resolved-at-runtime ' },
        { model: 'openrouter/c', apiKey: '' },
        { model: 'openrouter/d', apiKey: 42 },
      ])
    ).toEqual([
      { model: 'openrouter/a', apiKey: '{{OPENROUTER_API_KEY}}' },
      { model: 'openrouter/b', apiKey: 'sk-resolved-at-runtime' },
      { model: 'openrouter/c' },
      { model: 'openrouter/d' },
    ])
  })

  it('caps the chain', () => {
    const rows = Array.from({ length: MAX_FALLBACK_MODELS + 3 }, (_, i) => ({ model: `m-${i}` }))
    expect(normalizeFallbackModels(rows)).toHaveLength(MAX_FALLBACK_MODELS)
  })
})

describe('isViableFallbackModel', () => {
  it('rejects empty, sim-auto, the primary itself, and unresolvable ids', () => {
    expect(isViableFallbackModel('', 'gpt-5')).toBe(false)
    expect(isViableFallbackModel('sim-auto', 'gpt-5')).toBe(false)
    expect(isViableFallbackModel('GPT-5', 'gpt-5')).toBe(false)
    expect(isViableFallbackModel('mystery-model', 'gpt-5')).toBe(false)
  })

  it('offers any resolvable model that needs no provider-family credentials', () => {
    expect(isViableFallbackModel('claude-sonnet-5', 'gpt-5')).toBe(true)
    mockShouldRequireApiKey.mockReturnValue(true)
    expect(isViableFallbackModel('openrouter/x', 'gpt-5')).toBe(true)
  })

  it('offers a family-bound model only alongside a primary of the same family', () => {
    mockRequiresFamilyCredentials.mockImplementation((model: string) => model.startsWith('vertex/'))
    expect(isViableFallbackModel('vertex/gemini-b', 'vertex/gemini-a')).toBe(true)
    expect(isViableFallbackModel('vertex/gemini-b', 'gpt-5')).toBe(false)
  })
})

describe('fallbackRowNeedsApiKey', () => {
  it('is false when the model needs no key at all', () => {
    expect(fallbackRowNeedsApiKey('claude-sonnet-5', 'gpt-5')).toBe(false)
  })

  it('is false when the block key on the same provider can be reused', () => {
    mockShouldRequireApiKey.mockReturnValue(true)
    expect(fallbackRowNeedsApiKey('gpt-5-mini', 'gpt-5')).toBe(false)
  })

  it('is true for a keyed model on another provider', () => {
    mockShouldRequireApiKey.mockReturnValue(true)
    expect(fallbackRowNeedsApiKey('openrouter/x', 'gpt-5')).toBe(true)
  })
})

describe('tuning options and validity', () => {
  it('offers the provider-decides entry first, then what the model declares', () => {
    expect(getTuningOptionsForModel('gpt-small', 'reasoningEffort')).toEqual([
      'auto',
      'low',
      'high',
    ])
    expect(getTuningOptionsForModel('claude-sonnet-5', 'thinkingLevel')).toEqual([
      'none',
      'low',
      'medium',
      'high',
    ])
    expect(getTuningOptionsForModel('claude-sonnet-5', 'reasoningEffort')).toBeNull()
    expect(getTuningOptionsForModel('', 'verbosity')).toBeNull()
  })

  it('treats unset, the sentinel, and declared values as valid, and passes uncatalogued through', () => {
    expect(isTuningValueValidForModel('gpt-small', 'reasoningEffort', undefined)).toBe(true)
    expect(isTuningValueValidForModel('gpt-small', 'reasoningEffort', 'auto')).toBe(true)
    expect(isTuningValueValidForModel('gpt-small', 'reasoningEffort', 'High')).toBe(true)
    expect(isTuningValueValidForModel('gpt-small', 'reasoningEffort', 'xhigh')).toBe(false)
    expect(isTuningValueValidForModel('gpt-small', 'reasoningEffort', 42)).toBe(false)
    expect(isTuningValueValidForModel('openrouter/x', 'reasoningEffort', 'anything')).toBe(true)
    /** Catalogued but without the knob: nothing but unset or the sentinel is acceptable. */
    expect(isTuningValueValidForModel('claude-sonnet-5', 'reasoningEffort', 'high')).toBe(false)
    expect(isTuningValueValidForModel('claude-sonnet-5', 'reasoningEffort', 'auto')).toBe(true)
  })
})

describe('getFallbackTuningKnobsToShow', () => {
  it('shows a knob the primary lacks and one whose primary value the fallback does not declare', () => {
    expect(getFallbackTuningKnobsToShow('claude-sonnet-5', 'gpt-big', {})).toEqual([
      'thinkingLevel',
    ])
    expect(
      getFallbackTuningKnobsToShow('gpt-small', 'gpt-big', { reasoningEffort: 'xhigh' })
    ).toEqual(['reasoningEffort'])
  })

  it('stays bare when the primary value carries over or nothing is set', () => {
    expect(
      getFallbackTuningKnobsToShow('gpt-small', 'gpt-big', { reasoningEffort: 'high' })
    ).toEqual([])
    expect(getFallbackTuningKnobsToShow('gpt-small', 'gpt-big', {})).toEqual([])
    expect(
      getFallbackTuningKnobsToShow('gpt-small', 'gpt-big', { reasoningEffort: 'auto' })
    ).toEqual([])
  })
})

describe('resolveFallbackTuning', () => {
  it('prefers the row value, inherits a declared primary value, and drops the rest', () => {
    const resolved = resolveFallbackTuning(
      { model: 'gpt-small', reasoningEffort: 'low' },
      'gpt-big',
      {
        reasoningEffort: 'xhigh',
        verbosity: 'high',
      }
    )
    expect(resolved.reasoningEffort).toBe('low')
    expect(resolved.verbosity).toBe('high')
    expect(resolved.thinkingLevel).toBeUndefined()
    expect(resolved.adjustments).toEqual(['reasoningEffort: xhigh -> low'])
  })

  it('drops a primary value the fallback does not declare and says so', () => {
    const resolved = resolveFallbackTuning({ model: 'gpt-small' }, 'gpt-big', {
      reasoningEffort: 'xhigh',
    })
    expect(resolved.reasoningEffort).toBeUndefined()
    expect(resolved.adjustments).toEqual(['reasoningEffort: xhigh -> provider default'])
  })

  it('never inherits a knob the primary does not have', () => {
    const resolved = resolveFallbackTuning({ model: 'claude-sonnet-5' }, 'gpt-big', {
      thinkingLevel: 'high',
    })
    expect(resolved.thinkingLevel).toBeUndefined()
  })

  it('clamps temperature and max tokens to the fallback caps, keeping the input type', () => {
    const resolved = resolveFallbackTuning({ model: 'claude-sonnet-5' }, 'gpt-big', {
      temperature: '1.5',
      maxTokens: 20000,
    })
    expect(resolved.temperature).toBe('1')
    expect(resolved.maxTokens).toBe(20000)
    expect(resolved.adjustments).toEqual(['temperature: 1.5 -> 1'])

    const small = resolveFallbackTuning({ model: 'gpt-small' }, 'gpt-big', {
      temperature: 0.2,
      maxTokens: '20000',
    })
    expect(small.temperature).toBe(0.2)
    expect(small.maxTokens).toBe('4096')
  })

  it('passes everything through for an uncatalogued fallback', () => {
    const resolved = resolveFallbackTuning({ model: 'openrouter/x' }, 'gpt-big', {
      reasoningEffort: 'xhigh',
      temperature: '1.9',
      maxTokens: '99999',
    })
    expect(resolved).toEqual({
      reasoningEffort: 'xhigh',
      thinkingLevel: undefined,
      verbosity: undefined,
      temperature: '1.9',
      maxTokens: '99999',
      adjustments: [],
    })
  })
})

describe('resolveFallbackTuning hidden overrides', () => {
  it('ignores a stored row value once the primary value fits and the field is no longer shown', () => {
    const resolved = resolveFallbackTuning(
      { model: 'gpt-small', reasoningEffort: 'low' },
      'gpt-big',
      {
        reasoningEffort: 'high',
      }
    )
    expect(resolved.reasoningEffort).toBe('high')
    expect(resolved.adjustments).toEqual([])
  })
})

describe('normalizeTuningValues', () => {
  it('keeps trimmed lower-cased strings and drops blanks and non-strings', () => {
    expect(
      normalizeTuningValues({
        reasoningEffort: ' Low ',
        thinkingLevel: '',
        verbosity: 3,
        model: 'x',
      })
    ).toEqual({ reasoningEffort: 'low' })
  })
})

describe('row transforms', () => {
  const rows = [
    { id: 'a', model: 'gpt-big' },
    { id: 'b', model: 'openrouter/x', apiKey: '{{OPENROUTER_API_KEY}}', reasoningEffort: 'low' },
  ]

  it('adds a blank row until the cap and never past it', () => {
    expect(addFallbackRow(rows, 'c')).toEqual([...rows, { id: 'c', model: '' }])
    const full = Array.from({ length: MAX_FALLBACK_MODELS }, (_, i) => ({
      id: `r${i}`,
      model: 'm',
    }))
    expect(addFallbackRow(full, 'extra')).toBe(full)
  })

  it('removes by id and moves within bounds', () => {
    expect(removeFallbackRow(rows, 'a')).toEqual([rows[1]])
    expect(moveFallbackRow(rows, 'b', -1)).toEqual([rows[1], rows[0]])
    expect(moveFallbackRow(rows, 'a', -1)).toBe(rows)
    expect(moveFallbackRow(rows, 'b', 1)).toBe(rows)
    expect(moveFallbackRow(rows, 'missing', 1)).toBe(rows)
  })

  it('clears tuning on a model change and keeps the key only for the same keyed provider', () => {
    mockShouldRequireApiKey.mockReturnValue(true)
    expect(changeFallbackRowModel(rows, 'b', 'openrouter/y', 'claude-sonnet-5')[1]).toEqual({
      id: 'b',
      model: 'openrouter/y',
      apiKey: '{{OPENROUTER_API_KEY}}',
    })
    /** Another provider must never receive the previous provider's credential. */
    expect(changeFallbackRowModel(rows, 'b', 'gpt-small', 'claude-sonnet-5')[1]).toEqual({
      id: 'b',
      model: 'gpt-small',
    })
    mockShouldRequireApiKey.mockReturnValue(false)
    expect(changeFallbackRowModel(rows, 'b', 'openrouter/y', 'claude-sonnet-5')[1]).toEqual({
      id: 'b',
      model: 'openrouter/y',
    })
  })

  it('stores a tuning value, and the provider-decides entry as absence', () => {
    expect(changeFallbackRowTuning(rows, 'a', 'reasoningEffort', 'high')[0]).toEqual({
      id: 'a',
      model: 'gpt-big',
      reasoningEffort: 'high',
    })
    expect(changeFallbackRowTuning(rows, 'b', 'reasoningEffort', 'auto')[1]).toEqual({
      id: 'b',
      model: 'openrouter/x',
      apiKey: '{{OPENROUTER_API_KEY}}',
    })
    expect(changeFallbackRowApiKey(rows, 'a', '{{K}}')[0]).toEqual({
      id: 'a',
      model: 'gpt-big',
      apiKey: '{{K}}',
    })
  })
})

describe('ordinalChoiceLabel', () => {
  it('starts at the 2nd choice and handles English ordinals', () => {
    expect([0, 1, 2, 3, 9, 10, 11].map(ordinalChoiceLabel)).toEqual([
      '2nd choice',
      '3rd choice',
      '4th choice',
      '5th choice',
      '11th choice',
      '12th choice',
      '13th choice',
    ])
  })
})

import {
  providersModelsMock,
  providersModelsMockFns,
} from '@sim/testing/mocks/providers-models.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockShouldRequireApiKey, mockRequiresFamilyCredentials } = vi.hoisted(() => ({
  mockShouldRequireApiKey: vi.fn((model: string) => false),
  mockRequiresFamilyCredentials: vi.fn((provider: string | null | undefined) => false),
}))

vi.mock('@/blocks/utils', () => ({
  shouldRequireApiKeyForModel: mockShouldRequireApiKey,
  providerRequiresFamilyCredentials: mockRequiresFamilyCredentials,
}))

vi.mock('@/providers/models', () => providersModelsMock)

import {
  changeFallbackRowModel,
  fallbackRowNeedsApiKey,
  getFallbackTuningKnobsToShow,
  isViableFallbackModel,
  isWholeEnvVarReference,
  MAX_FALLBACK_MODELS,
  normalizeFallbackModels,
  normalizeTuningValues,
  resolveFallbackTuning,
} from '@/lib/workflows/blocks/fallback-models'

const {
  mockFindProviderFromModel,
  mockGetMaxTemperature,
  mockGetModelCapabilities,
  mockGetReasoningEffortValuesForModel,
  mockGetThinkingLevelsForModel,
  mockGetVerbosityValuesForModel,
  mockIsKnownModelId,
} = providersModelsMockFns
mockIsKnownModelId.mockImplementation(
  (model: string) => model.startsWith('gpt') || model.startsWith('claude')
)
mockFindProviderFromModel.mockImplementation((model: string) => {
  const lower = model.toLowerCase()
  if (lower.startsWith('gpt')) return 'openai'
  if (lower.startsWith('claude')) return 'anthropic'
  if (lower.startsWith('vertex/')) return 'vertex'
  if (lower.startsWith('openrouter/')) return 'openrouter'
  return null
})
mockGetReasoningEffortValuesForModel.mockImplementation((model: string) =>
  model === 'gpt-big'
    ? ['low', 'medium', 'high', 'xhigh']
    : model === 'gpt-small'
      ? ['low', 'high']
      : null
)
mockGetThinkingLevelsForModel.mockImplementation((model: string) =>
  model.startsWith('claude') ? ['low', 'medium', 'high'] : null
)
mockGetVerbosityValuesForModel.mockImplementation((model: string) =>
  model.startsWith('gpt') ? ['low', 'medium', 'high'] : null
)
mockGetMaxTemperature.mockImplementation((model: string) =>
  model.startsWith('claude') ? 1 : model.startsWith('gpt') ? 2 : undefined
)
mockGetModelCapabilities.mockImplementation((model: string) =>
  model === 'gpt-small'
    ? { maxOutputTokens: 4096 }
    : model.startsWith('gpt')
      ? { maxOutputTokens: 16000 }
      : model.startsWith('claude')
        ? {}
        : null
)

beforeEach(() => {
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

  it('offers a family-bound model only alongside a primary of the same family', () => {
    mockRequiresFamilyCredentials.mockImplementation((provider) => provider === 'vertex')
    expect(isViableFallbackModel('vertex/gemini-b', 'vertex/gemini-a')).toBe(true)
    expect(isViableFallbackModel('vertex/gemini-b', 'gpt-5')).toBe(false)
  })
})

describe('fallbackRowNeedsApiKey', () => {
  it('is false when the block key on the same provider can be reused', () => {
    mockShouldRequireApiKey.mockReturnValue(true)
    expect(fallbackRowNeedsApiKey('gpt-5-mini', 'gpt-5')).toBe(false)
  })

  it('is true for a keyed model on another provider', () => {
    mockShouldRequireApiKey.mockReturnValue(true)
    expect(fallbackRowNeedsApiKey('openrouter/x', 'gpt-5')).toBe(true)
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

  it('treats a value stored under an uncatalogued primary as stale, and lets the row decide', () => {
    /** The block never shows a graded knob for a model outside the catalog. */
    const stale = resolveFallbackTuning({ model: 'gpt-small' }, 'openrouter/custom', {
      reasoningEffort: 'high',
    })
    expect(stale.reasoningEffort).toBeUndefined()
    expect(stale.adjustments).toEqual(['reasoningEffort: high -> provider default'])

    const own = resolveFallbackTuning(
      { model: 'gpt-small', reasoningEffort: 'low' },
      'openrouter/custom',
      { reasoningEffort: 'high' }
    )
    expect(own.reasoningEffort).toBe('low')
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

    /** A value that never resolved to a number passes through untouched. */
    const unresolved = resolveFallbackTuning({ model: 'claude-sonnet-5' }, 'gpt-big', {
      temperature: '{{TEMP}}',
    })
    expect(unresolved.temperature).toBe('{{TEMP}}')
    expect(unresolved.adjustments).toEqual([])
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
    /** A key that is not a reference never survives an edit, even on the same provider. */
    mockShouldRequireApiKey.mockReturnValue(true)
    const raw = [{ id: 'r', model: 'openrouter/x', apiKey: 'sk-raw' }]
    expect(changeFallbackRowModel(raw, 'r', 'openrouter/y', 'claude-sonnet-5')[0]).toEqual({
      id: 'r',
      model: 'openrouter/y',
    })
  })
})

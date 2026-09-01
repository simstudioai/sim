/**
 * @vitest-environment node
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getPiModelOptions } from '@/blocks/utils'
import { resolvePiModelId } from '@/providers/pi-providers'
import { getProviderFromModel } from '@/providers/utils'
import { useProvidersStore } from '@/stores/providers/store'

const originalBaseModels = useProvidersStore.getState().providers.base.models
const originalOpenRouterModels = useProvidersStore.getState().providers.openrouter.models

describe('Pi model options', () => {
  beforeAll(() => {
    const store = useProvidersStore.getState()
    store.setProviderModels('base', [
      'claude-sonnet-4-6',
      'claude-opus-4-1',
      'claude-sonnet-4-0',
      'gpt-5.4',
      'cerebras/zai-glm-4.7',
      'glm-5.1',
      'glm-4.5-air',
    ])
    store.setProviderModels('openrouter', [
      'openrouter/openai/gpt-5',
      'openrouter/openrouter/fusion',
    ])
  })

  afterAll(() => {
    const store = useProvidersStore.getState()
    store.setProviderModels('base', originalBaseModels)
    store.setProviderModels('openrouter', originalOpenRouterModels)
  })

  it("only exposes models present in Pi's pinned catalog", () => {
    const options = getPiModelOptions()

    expect(options.length).toBeGreaterThan(0)
    for (const option of options) {
      const providerId = getProviderFromModel(option.id)
      expect(resolvePiModelId(providerId, option.id), option.id).toBeDefined()
    }
  })

  it('keeps current models and excludes stale catalog entries', () => {
    const modelIds = getPiModelOptions().map(({ id }) => id)

    expect(modelIds).toContain('claude-sonnet-4-6')
    expect(modelIds).not.toContain('claude-sonnet-4-0')
  })

  it('keeps persisted and selectable models available', () => {
    const modelIds = getPiModelOptions().map(({ id }) => id)

    expect(modelIds).toContain('claude-opus-4-1')
    expect(modelIds).toContain('cerebras/zai-glm-4.7')
    expect(modelIds).toContain('glm-5.1')
    expect(modelIds).toContain('glm-4.5-air')
  })

  it("does not apply OpenRouter capability filters beyond Pi's catalog", () => {
    const modelIds = getPiModelOptions().map(({ id }) => id)

    expect(modelIds).toContain('openrouter/openai/gpt-5')
    expect(modelIds).toContain('openrouter/openrouter/fusion')
  })
})

/**
 * @vitest-environment node
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getPiModelOptions } from '@/blocks/utils'
import { resolvePiModelId } from '@/providers/pi-providers'
import { getProviderFromModel } from '@/providers/utils'
import { useProvidersStore } from '@/stores/providers/store'

const originalBaseModels = useProvidersStore.getState().providers.base.models

describe('Pi model options', () => {
  beforeAll(() => {
    useProvidersStore
      .getState()
      .setProviderModels('base', ['claude-sonnet-4-6', 'claude-sonnet-4-0', 'gpt-5.4'])
  })

  afterAll(() => {
    useProvidersStore.getState().setProviderModels('base', originalBaseModels)
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
})

/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { USAGE_PROVIDER_ICON_IDS } from '@/ee/organization-usage/components/usage-consumers'
import { PROVIDER_DEFINITIONS } from '@/providers/models'

describe('PROVIDER_ICONS', () => {
  /**
   * The breakdown keys model rows by `getProviderFromModel`, which only ever returns
   * a registry provider id. A gap here is silent — the row simply renders without a
   * mark, which is how GLM shipped as the one iconless model in the list.
   */
  it('covers every provider the model registry defines', () => {
    const covered = new Set(USAGE_PROVIDER_ICON_IDS)
    const missing = Object.keys(PROVIDER_DEFINITIONS).filter((id) => !covered.has(id))
    expect(missing).toEqual([])
  })
})

/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { USAGE_PROVIDER_ICON_IDS } from '@/ee/organization-usage/components/usage-consumers'
import { PROVIDER_DEFINITIONS } from '@/providers/models'

describe('PROVIDER_ICONS', () => {
  /** A gap is silent: the row simply renders with no mark. */
  it('covers every provider the model registry defines', () => {
    const covered = new Set(USAGE_PROVIDER_ICON_IDS)
    const missing = Object.keys(PROVIDER_DEFINITIONS).filter((id) => !covered.has(id))
    expect(missing).toEqual([])
  })
})

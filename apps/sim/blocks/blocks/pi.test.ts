/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

const { envValues } = vi.hoisted(() => ({
  envValues: {
    NEXT_PUBLIC_E2B_ENABLED: 'true',
    NEXT_PUBLIC_PI_CREATE_PR_SEARCH_ENABLED: false,
  } as Record<string, unknown>,
}))

vi.mock('@/lib/core/config/env', () => ({
  env: {},
  getEnv: (key: string) => envValues[key],
  isTruthy: (value: unknown) => value === true || value === 'true',
}))

import { PiBlock } from '@/blocks/blocks/pi'

describe('Pi block internet search setting', () => {
  const search = PiBlock.subBlocks?.find((subBlock) => subBlock.id === 'enableInternetSearch')

  it('is default-off and hidden when the public rollout hint is disabled', () => {
    expect(search?.defaultValue).toBe(false)
    const condition =
      typeof search?.condition === 'function' ? search.condition() : search?.condition
    expect(condition).toEqual({ field: 'mode', value: '__pi_search_disabled__' })
  })

  it('is visible only for Create PR when the public rollout hint is enabled', () => {
    envValues.NEXT_PUBLIC_PI_CREATE_PR_SEARCH_ENABLED = true
    const condition =
      typeof search?.condition === 'function' ? search.condition() : search?.condition
    expect(condition).toEqual({ field: 'mode', value: 'cloud' })
  })
})

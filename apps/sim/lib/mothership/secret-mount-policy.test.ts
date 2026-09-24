import { describe, expect, it } from 'vitest'
import {
  applySecretMountPolicy,
  filterSecretNamesByMountPolicy,
  normalizeSecretMountPolicy,
} from '@/lib/mothership/secret-mount-policy'

describe('normalizeSecretMountPolicy', () => {
  it('defaults missing legacy policy data to all and fails malformed scopes closed', () => {
    expect(normalizeSecretMountPolicy()).toEqual({ secretScope: 'all', mountedSecrets: [] })
    expect(
      normalizeSecretMountPolicy({ secretScope: 'unknown', mountedSecrets: ['SECRET'] })
    ).toEqual({ secretScope: 'selected', mountedSecrets: [] })
  })

  it('canonicalizes a selected names-only allowlist', () => {
    expect(
      normalizeSecretMountPolicy({
        secretScope: 'selected',
        mountedSecrets: [' B ', 'A', 'B', '', 42],
      })
    ).toEqual({ secretScope: 'selected', mountedSecrets: ['B', 'A'] })
  })

  it('preserves selected with an empty list as no access', () => {
    expect(normalizeSecretMountPolicy({ secretScope: 'selected' })).toEqual({
      secretScope: 'selected',
      mountedSecrets: [],
    })
  })
})

describe('applySecretMountPolicy', () => {
  it('allows every explicit reference under the all policy', () => {
    expect(applySecretMountPolicy(['B', ' A ', 'B'])).toEqual(['B', 'A'])
  })

  it('returns exact explicit references under a selected policy', () => {
    expect(
      applySecretMountPolicy(['B'], {
        secretScope: 'selected',
        mountedSecrets: ['A', 'B'],
      })
    ).toEqual(['B'])
  })

  it('fails atomically when selected policy denies any reference', () => {
    expect(() =>
      applySecretMountPolicy(['A', 'B'], {
        secretScope: 'selected',
        mountedSecrets: ['A'],
      })
    ).toThrow('Secret access is not allowed for: B')
  })
})

describe('filterSecretNamesByMountPolicy', () => {
  it('keeps the complete inventory under the default all policy', () => {
    expect(filterSecretNamesByMountPolicy(['B', ' A ', 'B'])).toEqual(['B', 'A'])
  })

  it('hides names outside a selected allowlist while preserving inventory order', () => {
    expect(
      filterSecretNamesByMountPolicy(['A', 'B', 'C'], {
        secretScope: 'selected',
        mountedSecrets: ['C', 'A'],
      })
    ).toEqual(['A', 'C'])
  })

  it('hides the complete inventory when selected access is empty', () => {
    expect(
      filterSecretNamesByMountPolicy(['A'], {
        secretScope: 'selected',
        mountedSecrets: [],
      })
    ).toEqual([])
  })
})

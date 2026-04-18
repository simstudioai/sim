/**
 * @vitest-environment node
 */
import { featureFlagsMock } from '@sim/testing'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)

import { supabaseBaseUrl } from '@/tools/supabase/utils'

describe('supabaseBaseUrl', () => {
  it.concurrent('should return the correct URL for a valid project ID', () => {
    const url = supabaseBaseUrl('jdrkgepadsdopsntdlom')
    expect(url).toBe('https://jdrkgepadsdopsntdlom.supabase.co')
  })

  it.concurrent('should throw on fragment injection attempt', () => {
    expect(() => supabaseBaseUrl('evil#attacker.com')).toThrow()
  })

  it.concurrent('should throw on empty string', () => {
    expect(() => supabaseBaseUrl('')).toThrow()
  })

  it.concurrent('should throw on path traversal', () => {
    expect(() => supabaseBaseUrl('evil/../../etc')).toThrow()
  })

  it.concurrent('should throw on authority injection', () => {
    expect(() => supabaseBaseUrl('evil@attacker.com')).toThrow()
  })

  it.concurrent('should throw on uppercase letters', () => {
    expect(() => supabaseBaseUrl('ABCDEFGHIJKLMNOPQRST')).toThrow()
  })

  it.concurrent('should throw on too-short IDs', () => {
    expect(() => supabaseBaseUrl('abc')).toThrow()
  })
})

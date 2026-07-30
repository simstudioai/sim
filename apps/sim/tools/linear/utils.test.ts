/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { linearAuthorizationHeader } from '@/tools/linear/utils'

describe('linearAuthorizationHeader', () => {
  it('returns a personal API key bare without the Bearer scheme', () => {
    expect(linearAuthorizationHeader('lin_api_abc123')).toBe('lin_api_abc123')
  })

  it('returns OAuth access tokens with the Bearer scheme', () => {
    expect(linearAuthorizationHeader('lin_oauth_xyz789')).toBe('Bearer lin_oauth_xyz789')
    expect(linearAuthorizationHeader('some-opaque-token')).toBe('Bearer some-opaque-token')
  })
})

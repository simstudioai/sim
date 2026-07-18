import { describe, expect, it } from 'vitest'
import { isCredentialLikeFieldName } from '@/lib/apps/credential-boundary'

describe('isCredentialLikeFieldName', () => {
  it('rejects credential-like public field names', () => {
    expect(isCredentialLikeFieldName('credential')).toBe(true)
    expect(isCredentialLikeFieldName('oauthCredential')).toBe(true)
    expect(isCredentialLikeFieldName('access_token')).toBe(true)
    expect(isCredentialLikeFieldName('apiKey')).toBe(true)
    expect(isCredentialLikeFieldName('client_secret')).toBe(true)
    expect(isCredentialLikeFieldName('password')).toBe(true)
  })

  it('allows ordinary public input names', () => {
    expect(isCredentialLikeFieldName('query')).toBe(false)
    expect(isCredentialLikeFieldName('displayName')).toBe(false)
    expect(isCredentialLikeFieldName('limit')).toBe(false)
    expect(isCredentialLikeFieldName('fields')).toBe(false)
  })
})

/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  CredentialGroupOAuthError,
  CredentialGroupProviderConfigurationError,
} from '@/lib/credential-groups/provider-adapter'
import {
  internalCredentialErrorPolicy,
  internalPersonalCredentialConnectionErrorPolicy,
} from '@/lib/credentials/api/route-policies'
import { CredentialProviderOperationError } from '@/lib/credentials/application/credential-crud'
import {
  OAuthDisconnectConfigurationError,
  OAuthDisconnectLimitError,
  OAuthDisconnectPartialFailureError,
  OAuthProviderRevocationError,
} from '@/lib/credentials/oauth-accounts'

function project(error: unknown) {
  return internalCredentialErrorPolicy.project(error)
}

describe('internalCredentialErrorPolicy', () => {
  /**
   * The same failure used to render three ways — 503 on v2, 502 here, 502 from
   * `statusForCredentialOrchestrationError` — and only the v2 one told the
   * caller when to come back.
   */
  it('renders a provider outage as 503 with a Retry-After', () => {
    const response = project(
      new CredentialProviderOperationError('Provider unreachable', 'provider_unavailable', true)
    )

    expect(response?.status).toBe(503)
    expect(response?.headers).toEqual({ 'Retry-After': '5' })
    expect(response?.body).toMatchObject({ code: 'provider_unavailable' })
  })

  it('keeps a rejected secret a 400 with no retry advice', () => {
    const response = project(
      new CredentialProviderOperationError('Token rejected', 'invalid_credentials', false)
    )

    expect(response?.status).toBe(400)
    expect(response?.headers).toBeUndefined()
  })

  it('renders an OAuth revocation outage as retryable without exposing the provider response', () => {
    const response = project(
      new OAuthProviderRevocationError('QuickBooks', new Error('upstream token detail'))
    )

    expect(response?.status).toBe(503)
    expect(response?.headers).toEqual({ 'Retry-After': '5' })
    expect(response?.body).toEqual({
      error: 'Unable to revoke QuickBooks access. Please try again.',
    })
  })

  it('renders a disconnect size limit as a caller-fixable 400', () => {
    const response = project(new OAuthDisconnectLimitError('Too many linked accounts'))

    expect(response?.status).toBe(400)
    expect(response?.headers).toBeUndefined()
    expect(response?.body).toEqual({ error: 'Too many linked accounts' })
  })

  it('renders a local QuickBooks configuration problem as a non-retryable 400', () => {
    const response = project(
      new OAuthDisconnectConfigurationError('Reconnect the QuickBooks account and try again.')
    )

    expect(response?.status).toBe(400)
    expect(response?.headers).toBeUndefined()
    expect(response?.body).toEqual({ error: 'Reconnect the QuickBooks account and try again.' })
  })

  it('keeps a later revocation outage retryable after an earlier account was deleted', () => {
    const revocation = new OAuthProviderRevocationError(
      'QuickBooks',
      new Error('upstream token detail')
    )
    const response = project(new OAuthDisconnectPartialFailureError([], revocation))

    expect(response?.status).toBe(503)
    expect(response?.headers).toEqual({ 'Retry-After': '5' })
    expect(response?.body).toEqual({
      error: 'Unable to revoke QuickBooks access. Please try again.',
    })
  })

  it('defers anything that is not a provider failure to the base policy', () => {
    expect(project(new Error('unrelated'))).toBeNull()
  })
})

describe('personal account connection errors', () => {
  it('keeps account setup instructions actionable', () => {
    const response = internalPersonalCredentialConnectionErrorPolicy.project(
      new CredentialGroupProviderConfigurationError('private configuration detail')
    )
    expect(response).toMatchObject({
      status: 409,
      body: { error: 'Ask a workspace admin to configure this integration in Connected accounts' },
    })
  })

  it('preserves permission and configuration refusals', () => {
    const response = internalPersonalCredentialConnectionErrorPolicy.project(
      new CredentialGroupOAuthError('Required permissions were not granted', 403)
    )
    expect(response).toMatchObject({
      status: 403,
      body: { error: 'Required permissions were not granted' },
    })
  })

  it('does not expose upstream transport details', () => {
    const response = internalPersonalCredentialConnectionErrorPolicy.project(
      new CredentialGroupOAuthError('upstream credential response', 502)
    )
    expect(response).toMatchObject({
      status: 503,
      body: { error: 'Account sign-in is temporarily unavailable. Please try again.' },
    })
  })
})

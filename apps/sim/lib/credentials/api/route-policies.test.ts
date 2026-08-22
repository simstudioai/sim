/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { internalCredentialErrorPolicy } from '@/lib/credentials/api/route-policies'
import { CredentialProviderOperationError } from '@/lib/credentials/application/credential-crud'

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

  it('defers anything that is not a provider failure to the base policy', () => {
    expect(project(new Error('unrelated'))).toBeNull()
  })
})

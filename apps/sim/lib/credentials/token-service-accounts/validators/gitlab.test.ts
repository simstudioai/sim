/**
 * @vitest-environment node
 */
import { jsonResponse } from '@sim/testing/helpers/http'
import {
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing/mocks/input-validation.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

import { validateGitLabServiceAccount } from '@/lib/credentials/token-service-accounts/validators/token-checks'

const activeToken = { name: 'sim-workflows', active: true, revoked: false, scopes: ['api'] }

describe('GitLab saved token verification', () => {
  const fetch = inputValidationMockFns.mockSecureFetchWithPinnedIP
  const validateUrl = inputValidationMockFns.mockValidateUrlWithDNS

  beforeEach(() => {
    fetch.mockReset()
    validateUrl.mockReset().mockResolvedValue({
      isValid: true,
      resolvedIP: '203.0.113.7',
      originalHostname: 'gitlab.example.com',
    })
  })

  it('verifies the token at the host it was typed with and stores that host', async () => {
    fetch.mockResolvedValue(jsonResponse(activeToken))

    await expect(
      validateGitLabServiceAccount({
        apiToken: 'test-gitlab-token',
        domain: 'https://gitlab.example.com/',
      })
    ).resolves.toMatchObject({
      normalizedDomain: 'gitlab.example.com',
      displayName: 'sim-workflows (gitlab.example.com)',
      auditMetadata: { domain: 'gitlab.example.com' },
    })
    expect(fetch).toHaveBeenCalledWith(
      'https://gitlab.example.com/api/v4/personal_access_tokens/self',
      '203.0.113.7',
      expect.objectContaining({ maxRedirects: 0, profile: 'configuredEndpoint' })
    )
  })

  it('refuses a host that could send the token somewhere else, without calling it', async () => {
    await expect(
      validateGitLabServiceAccount({
        apiToken: 'test-gitlab-token',
        domain: 'evil.example.com@gitlab.com',
      })
    ).rejects.toMatchObject({ code: 'invalid_credentials' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    ['a revoked token', { ...activeToken, active: false, revoked: true }],
    ['a token without an API scope', { ...activeToken, scopes: ['read_repository'] }],
  ])('rejects %s', async (_, token) => {
    fetch.mockResolvedValue(jsonResponse(token))

    await expect(
      validateGitLabServiceAccount({ apiToken: 'test-gitlab-token', domain: 'gitlab.com' })
    ).rejects.toMatchObject({ code: 'invalid_credentials' })
  })

  it.each([
    ['an HTML page', new Response('<html>', { status: 200 })],
    ['JSON that is not a token lookup', jsonResponse({ ok: true })],
  ])('reports %s as GitLab misbehaving, not as a bad token', async (_, reply) => {
    fetch.mockResolvedValue(reply)

    await expect(
      validateGitLabServiceAccount({ apiToken: 'test-gitlab-token', domain: 'gitlab.com' })
    ).rejects.toMatchObject({ code: 'provider_unavailable' })
  })

  it('reports a host that does not exist as not found, so the user fixes it instead of retrying', async () => {
    validateUrl.mockResolvedValue({
      isValid: false,
      error: 'url hostname could not be resolved',
      refusal: 'dns',
      cause: Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }),
    })

    await expect(
      validateGitLabServiceAccount({ apiToken: 'test-gitlab-token', domain: 'gitlab.exmaple.com' })
    ).rejects.toMatchObject({ code: 'site_not_found' })
  })

  it('reports an unreachable GitLab instance as unavailable, not as a bad token', async () => {
    fetch.mockResolvedValue(jsonResponse({ message: 'Bad Gateway' }, 502))

    await expect(
      validateGitLabServiceAccount({ apiToken: 'test-gitlab-token', domain: 'gitlab.com' })
    ).rejects.toMatchObject({ code: 'provider_unavailable' })
  })
})

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

import { validateGitLabServiceAccount } from '@/lib/credentials/token-service-accounts/validators/gitlab'

const activeToken = { name: 'sim-workflows', active: true, revoked: false, scopes: ['api'] }

describe('GitLab saved token verification', () => {
  const fetch = inputValidationMockFns.mockSecureFetchWithValidation

  beforeEach(() => {
    fetch.mockReset()
  })

  it('verifies the token at the host it was typed with and stores that host', async () => {
    fetch.mockResolvedValue(jsonResponse(activeToken))

    await expect(
      validateGitLabServiceAccount({ apiToken: 'glpat-x', domain: 'https://gitlab.example.com/' })
    ).resolves.toMatchObject({ normalizedDomain: 'gitlab.example.com' })
    expect(fetch).toHaveBeenCalledWith(
      'https://gitlab.example.com/api/v4/personal_access_tokens/self',
      expect.objectContaining({ maxRedirects: 0, profile: 'configuredEndpoint' })
    )
  })

  it('refuses a host that could send the token somewhere else, without calling it', async () => {
    await expect(
      validateGitLabServiceAccount({ apiToken: 'glpat-x', domain: 'evil.example.com@gitlab.com' })
    ).rejects.toMatchObject({ code: 'invalid_credentials' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    ['a revoked token', { ...activeToken, active: false, revoked: true }],
    ['a token without an API scope', { ...activeToken, scopes: ['read_repository'] }],
  ])('rejects %s', async (_, token) => {
    fetch.mockResolvedValue(jsonResponse(token))

    await expect(
      validateGitLabServiceAccount({ apiToken: 'glpat-x', domain: 'gitlab.com' })
    ).rejects.toMatchObject({ code: 'invalid_credentials' })
  })

  it('reports an unreachable GitLab instance as unavailable, not as a bad token', async () => {
    fetch.mockResolvedValue(jsonResponse({ message: 'Bad Gateway' }, 502))

    await expect(
      validateGitLabServiceAccount({ apiToken: 'glpat-x', domain: 'gitlab.com' })
    ).rejects.toMatchObject({ code: 'provider_unavailable' })
  })
})

/**
 * @vitest-environment node
 */
import { jsonResponse } from '@sim/testing/helpers/http'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { validateBitbucketServiceAccount } from '@/lib/credentials/token-service-accounts/validators/token-checks'

const TOKEN = 'test-bitbucket-token'
const repository = { full_name: 'acme/api', slug: 'api' }

describe('Bitbucket saved access token verification', () => {
  const fetch = vi.fn()

  beforeEach(() => {
    fetch.mockReset()
    vi.stubGlobal('fetch', fetch)
  })

  it("reads the typed repository at Bitbucket's fixed API host", async () => {
    fetch.mockResolvedValue(jsonResponse(repository))

    await expect(
      validateBitbucketServiceAccount({ apiToken: TOKEN, providerWorkspaceId: ' acme/api ' })
    ).resolves.toMatchObject({
      displayName: 'Bitbucket (acme/api)',
      auditMetadata: { accountId: 'acme/api' },
    })
    expect(fetch).toHaveBeenCalledWith(
      'https://api.bitbucket.org/2.0/repositories/acme/api',
      expect.objectContaining({
        redirect: 'error',
        headers: expect.objectContaining({ Authorization: `Bearer ${TOKEN}` }),
      })
    )
  })

  it.each([
    ['a repository that climbs out of the workspace', 'acme/..'],
    ['a path that climbs further', 'acme/../../user'],
    ['a query that rewrites the request', 'acme/api?role=owner'],
    ['another host', 'evil.example.com/api'],
    ['an encoded separator', 'acme/api%2F..'],
    ['a workspace without a repository', 'acme'],
    ['nothing at all', '  '],
  ])('refuses %s as the repository without calling Bitbucket', async (_, workspace) => {
    await expect(
      validateBitbucketServiceAccount({ apiToken: TOKEN, providerWorkspaceId: workspace })
    ).rejects.toMatchObject({ code: 'invalid_credentials' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    ['a bad, expired, or revoked token', 401],
    ['a token without the repository scope', 403],
    ['a repository that does not exist or the token cannot reach', 404],
  ])('rejects %s as invalid credentials, never echoing the token', async (_, status) => {
    fetch.mockResolvedValue(
      jsonResponse({ type: 'error', error: { message: 'Token is invalid' } }, status)
    )

    const error = await validateBitbucketServiceAccount({
      apiToken: TOKEN,
      providerWorkspaceId: 'acme/api',
    }).catch((e) => e)

    expect(error).toMatchObject({ code: 'invalid_credentials' })
    expect(JSON.stringify(error.logDetail)).not.toContain(TOKEN)
  })

  it.each([
    ['an outage', new Response('<html>', { status: 502 })],
    ['a reply that is not a repository', jsonResponse({ values: [] })],
  ])('reports %s as Bitbucket being unavailable, not as a bad token', async (_, reply) => {
    fetch.mockResolvedValue(reply)

    await expect(
      validateBitbucketServiceAccount({ apiToken: TOKEN, providerWorkspaceId: 'acme/api' })
    ).rejects.toMatchObject({ code: 'provider_unavailable' })
  })
})

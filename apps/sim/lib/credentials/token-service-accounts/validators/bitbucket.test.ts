/**
 * @vitest-environment node
 */
import { jsonResponse } from '@sim/testing/helpers/http'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { validateBitbucketServiceAccount } from '@/lib/credentials/token-service-accounts/validators/token-checks'

const TOKEN = 'ATCTT3xFfGN0secretvalue'
const repositoryPage = { values: [{ full_name: 'acme/api' }], pagelen: 1 }

describe('Bitbucket saved access token verification', () => {
  const fetch = vi.fn()

  beforeEach(() => {
    fetch.mockReset()
    vi.stubGlobal('fetch', fetch)
  })

  it("lists one repository of the typed workspace at Bitbucket's fixed API host", async () => {
    fetch.mockResolvedValue(jsonResponse(repositoryPage))

    await expect(
      validateBitbucketServiceAccount({ apiToken: TOKEN, providerWorkspaceId: ' acme ' })
    ).resolves.toMatchObject({
      displayName: 'Bitbucket (acme)',
      auditMetadata: { accountId: 'acme' },
    })
    expect(fetch).toHaveBeenCalledWith(
      'https://api.bitbucket.org/2.0/repositories/acme?pagelen=1',
      expect.objectContaining({
        redirect: 'error',
        headers: expect.objectContaining({ Authorization: `Bearer ${TOKEN}` }),
      })
    )
  })

  it.each([
    ['a path that climbs out of the workspace', 'acme/../../user'],
    ['a query that rewrites the request', 'acme?role=owner'],
    ['another host', 'evil.example.com/'],
    ['an encoded separator', 'acme%2F..'],
    ['nothing at all', '  '],
  ])('refuses %s as the workspace without calling Bitbucket', async (_, workspace) => {
    await expect(
      validateBitbucketServiceAccount({ apiToken: TOKEN, providerWorkspaceId: workspace })
    ).rejects.toMatchObject({ code: 'invalid_credentials' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    ['a bad, expired, or revoked token', 401],
    ['a token without the repository scope', 403],
    ['a workspace that does not exist', 404],
  ])('rejects %s as invalid credentials, never echoing the token', async (_, status) => {
    fetch.mockResolvedValue(
      jsonResponse({ type: 'error', error: { message: 'Token is invalid' } }, status)
    )

    const error = await validateBitbucketServiceAccount({
      apiToken: TOKEN,
      providerWorkspaceId: 'acme',
    }).catch((e) => e)

    expect(error).toMatchObject({ code: 'invalid_credentials' })
    expect(JSON.stringify(error.logDetail)).not.toContain(TOKEN)
  })

  it.each([
    ['an outage', new Response('<html>', { status: 502 })],
    ['a reply that is not a repository page', jsonResponse({ ok: true })],
  ])('reports %s as Bitbucket being unavailable, not as a bad token', async (_, reply) => {
    fetch.mockResolvedValue(reply)

    await expect(
      validateBitbucketServiceAccount({ apiToken: TOKEN, providerWorkspaceId: 'acme' })
    ).rejects.toMatchObject({ code: 'provider_unavailable' })
  })
})

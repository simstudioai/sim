/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { validateAtlassianServiceAccount } from '@/lib/credentials/atlassian-service-account'

const fetchMock = vi.fn<typeof fetch>()

describe('Atlassian service-account identity verification', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValueOnce(Response.json({ cloudId: 'cloud-1' }))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('verifies a Confluence-only token without requiring Jira access', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ accountId: 'bot-1', displayName: 'Search bot', email: 'bot@example.test' })
    )
    expect(
      await validateAtlassianServiceAccount('token', 'acme.atlassian.net', 'confluence')
    ).toEqual({
      accountId: 'bot-1',
      displayName: 'Search bot',
      cloudId: 'cloud-1',
      emailAddress: 'bot@example.test',
    })
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://api.atlassian.com/ex/confluence/cloud-1/wiki/rest/api/user/current',
      expect.objectContaining({
        headers: { Authorization: 'Bearer token', Accept: 'application/json' },
      })
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('preserves the Jira identity endpoint for legacy callers', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ accountId: 'jira-1', emailAddress: 'jira@example.test' })
    )
    expect(await validateAtlassianServiceAccount('token', 'acme.atlassian.net')).toMatchObject({
      accountId: 'jira-1',
      displayName: 'jira@example.test',
      emailAddress: 'jira@example.test',
    })
    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://api.atlassian.com/ex/jira/cloud-1/rest/api/3/myself'
    )
  })

  it.each([401, 403])(
    'does not retry another product when Confluence rejects authentication (%s)',
    async (status) => {
      fetchMock.mockResolvedValueOnce(Response.json({ message: 'Rejected' }, { status }))
      await expect(
        validateAtlassianServiceAccount('token', 'acme.atlassian.net', 'confluence')
      ).rejects.toMatchObject({
        code: 'invalid_credentials',
        status,
      })
      expect(fetchMock).toHaveBeenCalledTimes(2)
    }
  )

  it('accepts a privacy-hidden email only when a stable account ID is present', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ accountId: 'bot-1', displayName: 'Search bot' })
    )
    expect(
      await validateAtlassianServiceAccount('token', 'acme.atlassian.net', 'confluence')
    ).not.toHaveProperty('emailAddress')
  })

  it('rejects an identity response without its account ID', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ displayName: 'Incomplete' }))
    await expect(
      validateAtlassianServiceAccount('token', 'acme.atlassian.net', 'confluence')
    ).rejects.toMatchObject({ code: 'atlassian_unavailable' })
  })

  it('rejects non-Atlassian hosts before sending any credential', async () => {
    await expect(
      validateAtlassianServiceAccount('token', 'localhost', 'confluence')
    ).rejects.toMatchObject({ code: 'site_not_found' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

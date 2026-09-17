/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAtlassianCloudIdCache } from '@/lib/atlassian/discovery'
import { confluenceConnector } from '@/connectors/confluence/confluence'
import { jiraConnector } from '@/connectors/jira/jira'

const DOMAIN = 'all-validation.atlassian.net'
const CLOUD_ID = 'all-validation-cloud'
const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  fetchMock.mockReset()
  clearAtlassianCloudIdCache()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => vi.unstubAllGlobals())

describe('dynamic All source validation', () => {
  describe.each([
    { name: 'Jira', connector: jiraConnector, field: 'projectKey' },
    { name: 'Confluence', connector: confluenceConnector, field: 'spaceKey' },
  ])('$name mixed All selection', ({ connector, field }) => {
    const error = 'Use "*" by itself for All, or remove it to select individual items.'

    it.each([{ value: '*, ENG' }, { value: ['*', 'ENG'] }, { value: ['ENG', ' * '] }])(
      'rejects mixed keys before validation requests (%j)',
      async ({ value }) => {
        await expect(
          connector.validateConfig('token', { domain: DOMAIN, [field]: value })
        ).resolves.toEqual({ valid: false, error })
        expect(fetchMock).not.toHaveBeenCalled()
      }
    )

    it.each([false, true])(
      'rejects mixed keys before listing or splitting the scope (per member: %s)',
      async (perMemberListing) => {
        await expect(
          connector.listDocuments('token', { domain: DOMAIN, [field]: ['*', 'ENG'] }, undefined, {
            perMemberListing,
          })
        ).rejects.toThrow(error)
        expect(fetchMock).not.toHaveBeenCalled()
      }
    )

    it('rejects mixed keys during resumed hydration before reading the provider', async () => {
      await expect(
        connector.getDocument('token', { domain: DOMAIN, [field]: 'ENG, *' }, 'document-1')
      ).rejects.toThrow(error)
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  it.each([{ value: '*' }, { value: ['*'] }])(
    'validates Confluence All without enumerating or submitting literal space keys (%j)',
    async ({ value: spaceKey }) => {
      fetchMock.mockResolvedValueOnce(
        Response.json({
          results: [{ id: 'space-1', key: 'ENG' }],
          _links: { next: '?cursor=more-spaces' },
        })
      )
      await expect(
        confluenceConnector.validateConfig(
          'token',
          { domain: DOMAIN, spaceKey },
          { cloudId: CLOUD_ID, credentialDomain: DOMAIN }
        )
      ).resolves.toEqual({ valid: true })
      expect(fetchMock).toHaveBeenCalledOnce()
      const [input, options] = fetchMock.mock.calls[0]
      const url = new URL(String(input))
      expect(url.pathname).toBe(`/ex/confluence/${CLOUD_ID}/wiki/api/v2/spaces`)
      expect(url.searchParams.get('limit')).toBe('1')
      expect(url.searchParams.has('keys')).toBe(false)
      expect(options?.headers).toMatchObject({ Authorization: 'Bearer token' })
    }
  )

  it('does not let Confluence All bypass the service-account site binding', async () => {
    await expect(
      confluenceConnector.validateConfig(
        'token',
        { domain: DOMAIN, spaceKey: ['*'] },
        { cloudId: CLOUD_ID, credentialDomain: 'other.atlassian.net' }
      )
    ).resolves.toMatchObject({ valid: false, error: expect.stringContaining('must match') })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not accept Confluence All when the provider denies space discovery', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({}, { status: 403 }))
    await expect(
      confluenceConnector.validateConfig(
        'token',
        { domain: DOMAIN, spaceKey: '*' },
        { cloudId: CLOUD_ID }
      )
    ).resolves.toMatchObject({ valid: false, error: expect.stringContaining('403') })
  })

  it.each([{ value: '*' }, { value: ['*'] }])(
    'validates Jira All and its optional filter under the supplied account (%j)',
    async ({ value: projectKey }) => {
      fetchMock.mockImplementation(async () => Response.json({ issues: [] }))
      await expect(
        jiraConnector.validateConfig(
          'token',
          { domain: DOMAIN, projectKey, jql: 'status = "Done"' },
          { cloudId: CLOUD_ID }
        )
      ).resolves.toEqual({ valid: true })
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(
        fetchMock.mock.calls.map(([input]) => new URL(String(input)).searchParams.get('jql'))
      ).toEqual(['project IS NOT EMPTY', 'project IS NOT EMPTY AND (status = "Done")'])
      for (const [input, options] of fetchMock.mock.calls) {
        const url = new URL(String(input))
        expect(url.pathname).toBe(`/ex/jira/${CLOUD_ID}/rest/api/3/search/jql`)
        expect(url.searchParams.get('maxResults')).toBe('1')
        expect(options?.headers).toMatchObject({ Authorization: 'Bearer token' })
      }
    }
  )

  it('does not let Jira All bypass current account site discovery', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json([{ id: 'other-cloud', url: 'https://other.atlassian.net' }])
    )
    await expect(
      jiraConnector.validateConfig(
        'token',
        { domain: DOMAIN, projectKey: ['*'] },
        { perMemberListing: true }
      )
    ).resolves.toMatchObject({
      valid: false,
      error: expect.stringContaining('Could not match Jira domain'),
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      'https://api.atlassian.com/oauth/token/accessible-resources'
    )
  })

  it('does not accept Jira All when the provider denies issue search', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({}, { status: 403 }))
    await expect(
      jiraConnector.validateConfig(
        'token',
        { domain: DOMAIN, projectKey: '*' },
        { cloudId: CLOUD_ID }
      )
    ).resolves.toMatchObject({ valid: false, error: expect.stringContaining('403') })
  })
})

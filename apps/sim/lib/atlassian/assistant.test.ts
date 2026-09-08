/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAtlassianCloudIdCache } from '@/lib/atlassian/discovery'
import {
  assertAssistantIntegrationCall,
  isAssistantIntegrationTool,
} from '@/lib/copilot/assistant/tool-policy'
import { createConfluenceClient } from '@/lib/internal/confluence/client'
import { createJiraClient } from '@/lib/internal/jira/client'
import { getToolMetadata } from '@/tools/metadata'
import { getToolIds } from '@/tools/tool-ids'

vi.unmock('@/tools/metadata')
vi.unmock('@/tools/tool-ids')

const CLOUD_ID = '12345678-1234-1234-1234-123456789012'
const OTHER_CLOUD_ID = '12345678-1234-1234-1234-123456789013'
const DOMAIN = 'selected.atlassian.net'
const TOKEN = 'personal-account-token'
const DISCOVERY_URL = 'https://api.atlassian.com/oauth/token/accessible-resources'

describe('Atlassian Assistant resource selection', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    vi.clearAllMocks()
    clearAtlassianCloudIdCache()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => vi.unstubAllGlobals())

  it.each(['jira', 'confluence'])(
    'offers %s operations with a site selector and personal credential',
    (service) => {
      const tools = getToolIds()
        .filter((id) => id.startsWith(`${service}_`))
        .map((id) => getToolMetadata(id))
        .filter((tool) => tool?.params.domain)
      expect(tools.length).toBeGreaterThan(0)
      for (const tool of tools) {
        expect(tool?.params.domain.visibility, tool?.id).toBe('user-or-llm')
        expect(isAssistantIntegrationTool(tool), tool?.id).toBe(true)
        expect(() =>
          assertAssistantIntegrationCall(tool, { credentialId: 'mine', domain: DOMAIN })
        ).not.toThrow()
        for (const name of ['cloudId', 'accessToken', '_context']) {
          expect(() =>
            assertAssistantIntegrationCall(tool, {
              credentialId: 'mine',
              domain: DOMAIN,
              [name]: 'override',
            })
          ).toThrow()
        }
      }
    }
  )

  it.each(['jira', 'confluence'])(
    'uses token-authorized %s discovery without sending credentials to the selected domain',
    async (service) => {
      fetchMock
        .mockResolvedValueOnce(
          Response.json([
            { id: OTHER_CLOUD_ID, url: 'https://other.atlassian.net' },
            { id: CLOUD_ID, url: `https://${DOMAIN}` },
          ])
        )
        .mockResolvedValueOnce(Response.json({ id: 'resource' }))

      if (service === 'jira') {
        const client = await createJiraClient(
          { accessToken: TOKEN, domain: DOMAIN },
          { validateCloudId: true }
        )
        await client.request(client.issuePath('/TEST-1'), { method: 'GET' })
      } else {
        const client = await createConfluenceClient({ accessToken: TOKEN, domain: DOMAIN })
        await client.json(client.apiV2('/pages/123'))
      }

      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        DISCOVERY_URL,
        expect.objectContaining({
          headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' },
        })
      )
      const [url, init] = fetchMock.mock.calls[1]
      expect(String(url)).toContain(`https://api.atlassian.com/ex/${service}/${CLOUD_ID}/`)
      expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${TOKEN}`)
      expect(
        fetchMock.mock.calls.every(([url]) => new URL(String(url)).host === 'api.atlassian.com')
      ).toBe(true)
    }
  )

  it.each(['jira', 'confluence'])(
    'refuses an unmatched %s site without a provider API call',
    async (service) => {
      fetchMock.mockResolvedValueOnce(
        Response.json([
          { id: CLOUD_ID, url: `https://${DOMAIN}` },
          { id: OTHER_CLOUD_ID, url: 'https://other.atlassian.net' },
        ])
      )
      const connection = { accessToken: TOKEN, domain: 'untrusted.example' }
      await expect(
        service === 'jira'
          ? createJiraClient(connection, { validateCloudId: true })
          : createConfluenceClient(connection)
      ).rejects.toThrow('Could not match')
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock.mock.calls[0][0]).toBe(DISCOVERY_URL)
    }
  )
})

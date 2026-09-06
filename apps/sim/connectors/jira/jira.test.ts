/**
 * @vitest-environment node
 */
import { createMockResponse } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AtlassianSiteNotMatchedError, clearAtlassianCloudIdCache } from '@/lib/atlassian/discovery'
import {
  beginListingCheckpoint,
  runResumableListing,
} from '@/lib/knowledge/connectors/listing-checkpoint'
import { jiraConnector } from '@/connectors/jira/jira'
import { jiraConnectorMeta } from '@/connectors/jira/meta'
import { memberDocumentId, PER_MEMBER_LISTING_CONTEXT } from '@/connectors/utils'

const SOURCE = { domain: 'acme.atlassian.net', projectKey: 'ENG' }
const CLOUD_ID = 'cloud-acme'
const MEMBERS = { ...PER_MEMBER_LISTING_CONTEXT, memberId: 'member-one', cloudId: CLOUD_ID }

function adf(text: string) {
  return {
    type: 'doc',
    version: 1,
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  }
}

function issue(id = '10001', fields: Record<string, unknown> = {}) {
  return {
    id,
    key: `ENG-${id}`,
    fields: {
      project: { id: '10000', key: 'ENG' },
      summary: 'Fix onboarding',
      description: adf('Make setup easier'),
      updated: '2026-09-05T12:00:00Z',
      status: { name: 'In Progress' },
      issuetype: { name: 'Task' },
      priority: { name: 'High' },
      assignee: { displayName: 'Alex' },
      labels: ['search'],
      ...fields,
    },
  }
}

function json(body: unknown, status = 200) {
  return createMockResponse({ json: body, status })
}

const fetchMock = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  fetchMock.mockReset()
  clearAtlassianCloudIdCache()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Jira Search member documents', () => {
  it('offers managed member Search with canonical project setup and no central ACL mode', () => {
    expect(jiraConnectorMeta.search).toBe(true)
    expect(jiraConnectorMeta.permissionScopedListing?.capFieldIds).toEqual(['maxIssues'])
    expect(jiraConnectorMeta.mirrorsSourceAcls).toBeUndefined()
    expect(jiraConnectorMeta.supportsSeparateContentCredential).toBeUndefined()
    expect(jiraConnectorMeta.auth).toEqual({
      mode: 'oauth',
      provider: 'jira',
      requiredScopes: ['read:jira-work', 'offline_access'],
    })
    expect(
      jiraConnectorMeta.configFields.filter((field) => field.canonicalParamId === 'projectKey')
    ).toEqual([
      expect.objectContaining({ selectorKey: 'jira.projects', mode: 'basic', required: true }),
      expect.objectContaining({ id: 'projectKey', mode: 'advanced', required: true }),
    ])
  })

  it('indexes the visible title and description inline without restricted comments', async () => {
    fetchMock.mockResolvedValue(
      json({
        issues: [
          issue('10001', {
            comment: { comments: [{ body: adf('Administrator-only incident details') }], total: 1 },
          }),
        ],
      })
    )

    const result = await jiraConnector.listDocuments('token', SOURCE, undefined, { ...MEMBERS })

    expect(result.documents).toHaveLength(1)
    expect(result.documents[0]).toMatchObject({
      externalId: memberDocumentId(`jira:${CLOUD_ID}:10001`, MEMBERS),
      content: 'Fix onboarding\n\nMake setup easier',
      contentDeferred: false,
      sourceUrl: 'https://acme.atlassian.net/browse/ENG-10001',
    })
    expect(JSON.stringify(result.documents)).not.toContain('Administrator-only')
    const url = new URL(String(fetchMock.mock.calls[0][0]))
    expect(url.pathname).toBe(`/ex/jira/${CLOUD_ID}/rest/api/3/search/jql`)
    expect(url.searchParams.get('fields')?.split(',')).toContain('description')
    expect(url.searchParams.get('fields')?.split(',')).not.toContain('comment')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps the same issue isolated across members and sites', async () => {
    fetchMock.mockResolvedValue(json({ issues: [issue()] }))
    const contexts = [
      MEMBERS,
      { ...MEMBERS, memberId: 'member-two' },
      { ...MEMBERS, cloudId: 'other-site' },
    ]
    const ids: string[] = []
    for (const context of contexts) {
      const result = await jiraConnector.listDocuments('token', SOURCE, undefined, { ...context })
      ids.push(result.documents[0]!.externalId)
    }
    expect(new Set(ids).size).toBe(3)
  })

  it('refreshes a changed visible projection even when the issue timestamp is unchanged', async () => {
    fetchMock.mockResolvedValueOnce(json({ issues: [issue()] }))
    fetchMock.mockResolvedValueOnce(
      json({ issues: [issue('10001', { description: null, assignee: null })] })
    )

    const before = await jiraConnector.listDocuments('token', SOURCE, undefined, { ...MEMBERS })
    const after = await jiraConnector.listDocuments('token', SOURCE, undefined, { ...MEMBERS })

    expect(before.documents[0]!.externalId).toBe(after.documents[0]!.externalId)
    expect(before.documents[0]!.contentHash).not.toBe(after.documents[0]!.contentHash)
    expect(after.documents[0]!.content).toBe('Fix onboarding')
  })

  it('preserves the member hash and ID when retrieving the same visible projection', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ issues: [issue()] }))
      .mockResolvedValueOnce(json(issue()))
    const listed = await jiraConnector.listDocuments('token', SOURCE, undefined, { ...MEMBERS })
    const fetched = await jiraConnector.getDocument(
      'token',
      SOURCE,
      listed.documents[0]!.externalId,
      { ...MEMBERS }
    )
    expect(fetched).toEqual(listed.documents[0])
    expect(new URL(String(fetchMock.mock.calls[1][0])).pathname).toMatch(/\/issue\/10001$/)
  })

  it.each([
    '10001',
    'member:member-two:jira:cloud-acme:10001',
    'member:member-one:jira:other-site:10001',
  ])('refuses a foreign or unscoped issue ID %s', async (externalId) => {
    await expect(
      jiraConnector.getDocument('token', SOURCE, externalId, { ...MEMBERS })
    ).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not publish an unscoped member document when canonical member identity is absent', async () => {
    fetchMock.mockResolvedValue(json({ issues: [issue()] }))
    await expect(
      jiraConnector.listDocuments('token', SOURCE, undefined, {
        ...PER_MEMBER_LISTING_CONTEXT,
        cloudId: CLOUD_ID,
      })
    ).rejects.toThrow()
  })

  it('does not substitute a sole other Atlassian site for the configured site', async () => {
    fetchMock.mockResolvedValue(json([{ id: 'other-cloud', url: 'https://other.atlassian.net' }]))
    const promise = jiraConnector.listDocuments('token', SOURCE, undefined, {
      ...PER_MEMBER_LISTING_CONTEXT,
      memberId: 'member-one',
    })
    await expect(promise).rejects.toBeInstanceOf(AtlassianSiteNotMatchedError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('Jira pagination and source scope', () => {
  it('follows opaque enhanced-search tokens even when a page is short', async () => {
    fetchMock.mockResolvedValueOnce(
      json({ issues: [issue()], nextPageToken: 'opaque|next', isLast: false })
    )
    fetchMock.mockResolvedValueOnce(json({ issues: [issue('10002')], isLast: true }))
    const context = { cloudId: CLOUD_ID }
    const first = await jiraConnector.listDocuments('token', SOURCE, undefined, context)
    const second = await jiraConnector.listDocuments('token', SOURCE, first.nextCursor, context)
    expect(first.hasMore).toBe(true)
    expect(second.hasMore).toBe(false)
    expect(new URL(String(fetchMock.mock.calls[1][0])).searchParams.get('nextPageToken')).toBe(
      'opaque|next'
    )
  })

  it.each([
    { issues: [], isLast: false },
    { issues: [], nextPageToken: 'repeat' },
    { results: [] },
    { issues: [{ id: '10001', key: 'ENG-1', fields: {} }] },
  ])('fails incomplete or malformed listings instead of reconciling deletions', async (body) => {
    fetchMock.mockResolvedValue(json(body))
    await expect(
      jiraConnector.listDocuments('token', SOURCE, 'repeat|1', { cloudId: CLOUD_ID })
    ).rejects.toThrow()
  })

  it('marks an item-capped workspace listing incomplete and sizes the last request', async () => {
    fetchMock.mockResolvedValue(json({ issues: [issue()], nextPageToken: 'next' }))
    const context: Record<string, unknown> = { cloudId: CLOUD_ID }
    const result = await jiraConnector.listDocuments(
      'token',
      { ...SOURCE, maxIssues: '3' },
      'start|2',
      context
    )
    expect(result.hasMore).toBe(false)
    expect(context.listingCapped).toBe(true)
    expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.get('maxResults')).toBe('1')
  })

  it('permits deletion reconciliation on genuine exhaustion at the item limit', async () => {
    fetchMock.mockResolvedValue(json({ issues: [issue()], isLast: true }))
    const context: Record<string, unknown> = { cloudId: CLOUD_ID }
    await jiraConnector.listDocuments('token', { ...SOURCE, maxIssues: '1' }, undefined, context)
    expect(context.listingCapped).toBeUndefined()
  })

  it('marks a provider-degraded result incomplete', async () => {
    fetchMock.mockResolvedValue(
      json({ issues: [issue()], warnings: [{ type: 'INGESTION_LIMIT' }] })
    )
    const context: Record<string, unknown> = { ...MEMBERS }
    await jiraConnector.listDocuments('token', SOURCE, undefined, context)
    expect(context.listingCapped).toBe(true)
  })

  it('allows authoritative empty member results so removed access can be withdrawn', async () => {
    fetchMock.mockResolvedValue(json({ issues: [], isLast: true, nextPageToken: null }))
    const context: Record<string, unknown> = { ...MEMBERS }
    expect(await jiraConnector.listDocuments('token', SOURCE, undefined, context)).toEqual({
      documents: [],
      hasMore: false,
      nextCursor: undefined,
    })
    expect(context.listingCapped).toBeUndefined()
  })

  it('recognizes the provider invalid-or-expired page-token response for a resumable listing', async () => {
    fetchMock.mockResolvedValue(
      json({ errorMessages: ['The provided next page token is invalid or expired.'] }, 400)
    )
    const error = await jiraConnector
      .listDocuments('token', SOURCE, 'expired-token|100', { ...MEMBERS })
      .catch((value: unknown) => value)
    expect(error).toBeInstanceOf(Error)
    expect(jiraConnector.isListingCursorInvalidError?.(error)).toBe(true)
    expect(jiraConnector.isCredentialInvalidError?.(error)).toBe(false)
    expect(jiraConnector.isListingScopeUnavailableError?.(error)).toBe(false)
  })

  it('restarts expired pagination through the shared runner without carrying over an old item count', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ issues: [issue('1'), issue('2')], nextPageToken: 'expired' }))
      .mockResolvedValueOnce(
        json({ errorMessages: ['The provided next page token is invalid or expired.'] }, 400)
      )
      .mockResolvedValueOnce(json({ issues: [issue('1'), issue('2')], nextPageToken: 'fresh' }))
      .mockResolvedValueOnce(json({ issues: [issue('3')], isLast: true }))
    const checkpoint = beginListingCheckpoint({
      fingerprint: '0'.repeat(64),
      generationId: 'original-generation',
      startedAt: new Date(),
    })
    const processed: { generationId: string; ids: string[] }[] = []
    const context: Record<string, unknown> = { cloudId: CLOUD_ID }
    const completed = await runResumableListing({
      connectorConfig: jiraConnector,
      sourceConfig: { ...SOURCE, maxIssues: 3 },
      syncContext: context,
      checkpoint,
      deadlineAt: Date.now() + 10000,
      beforePage: async () => {},
      getAccessToken: async () => 'token',
      processPage: async (documents, page) => {
        processed.push({
          generationId: page.generationId,
          ids: documents.map((doc) => doc.externalId),
        })
      },
      saveCheckpoint: async () => {},
    })
    expect(completed).toMatchObject({ complete: true, listedCount: 3, unsafe: false, cursor: null })
    expect(completed.generationId).not.toBe('original-generation')
    expect(
      processed
        .filter((page) => page.generationId === completed.generationId)
        .flatMap((page) => page.ids)
    ).toEqual(['1', '2', '3'])
    expect(
      fetchMock.mock.calls.map(([input]) => new URL(String(input)).searchParams.get('maxResults'))
    ).toEqual(['3', '1', '3', '1'])
    expect(context.listingCapped).toBeUndefined()
  })

  it.each([
    {
      status: 400,
      cursor: undefined,
      message: 'The provided next page token is invalid or expired.',
    },
    { status: 400, cursor: 'valid-token|100', message: 'Invalid JQL syntax.' },
    {
      status: 403,
      cursor: 'valid-token|100',
      message: 'The provided next page token is invalid or expired.',
    },
    {
      status: 500,
      cursor: 'valid-token|100',
      message: 'The provided next page token is invalid or expired.',
    },
  ])(
    'does not reset a cursor for unrelated search failure %j',
    async ({ status, cursor, message }) => {
      fetchMock.mockResolvedValue(json({ errorMessages: [message] }, status))
      const error = await jiraConnector
        .listDocuments('token', SOURCE, cursor, { ...MEMBERS })
        .catch((value: unknown) => value)
      expect(error).toBeInstanceOf(Error)
      expect(jiraConnector.isListingCursorInvalidError?.(error) ?? false).toBe(false)
    }
  )

  it('keeps a JQL refinement inside the configured projects and accepts selector project IDs', async () => {
    fetchMock.mockResolvedValue(
      json({ issues: [issue(), issue('20001', { project: { id: '20000', key: 'PRIVATE' } })] })
    )
    const result = await jiraConnector.listDocuments(
      'token',
      {
        ...SOURCE,
        projectKey: ['10000'],
        jql: 'status = "Done") OR project = PRIVATE OR (status = "Open"',
      },
      undefined,
      { ...MEMBERS }
    )
    expect(result.documents.map((document) => document.metadata?.key)).toEqual(['ENG-10001'])
  })

  it('escapes literal project keys before composing JQL', async () => {
    fetchMock.mockResolvedValue(json({ issues: [] }))
    await jiraConnector.listDocuments(
      'token',
      { ...SOURCE, projectKey: ['A" OR project = "B', 'C\\D'] },
      undefined,
      { cloudId: CLOUD_ID }
    )
    const jql = new URL(String(fetchMock.mock.calls[0][0])).searchParams.get('jql')
    expect(jql).toBe('project in ("A\\" OR project = \\"B","C\\\\D") ORDER BY updated DESC')
  })
})

describe('Jira validation and provider failures', () => {
  it.each(['1.5', '-1', '0', 'NaN', 'Infinity'])(
    'rejects invalid issue limit %s',
    async (maxIssues) => {
      await expect(
        jiraConnector.validateConfig('token', { ...SOURCE, maxIssues })
      ).resolves.toMatchObject({
        valid: false,
        error: 'Max issues must be a positive whole number',
      })
      expect(fetchMock).not.toHaveBeenCalled()
    }
  )

  it('refuses member listing caps at runtime and setup', async () => {
    const source = { ...SOURCE, maxIssues: '10' }
    await expect(
      jiraConnector.listDocuments('token', source, undefined, { ...MEMBERS })
    ).rejects.toThrow('cannot limit')
    await expect(
      jiraConnector.validateConfig('token', source, { ...MEMBERS })
    ).resolves.toMatchObject({ valid: false })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('validates projects and the optional JQL with lightweight enhanced-search calls', async () => {
    fetchMock.mockResolvedValue(json({ issues: [] }))
    await expect(
      jiraConnector.validateConfig(
        'token',
        { ...SOURCE, jql: 'status = "Done"' },
        { cloudId: CLOUD_ID }
      )
    ).resolves.toEqual({ valid: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    for (const [input] of fetchMock.mock.calls) {
      const url = new URL(String(input))
      expect(url.pathname).toMatch(/\/search\/jql$/)
      expect(url.searchParams.get('maxResults')).toBe('1')
      expect(url.searchParams.get('fields')).toBe('id')
    }
  })

  it('validates exact configured site during member setup', async () => {
    fetchMock.mockResolvedValue(json([{ id: 'other-cloud', url: 'https://other.atlassian.net' }]))
    await expect(
      jiraConnector.validateConfig('token', SOURCE, { ...PER_MEMBER_LISTING_CONTEXT })
    ).resolves.toMatchObject({
      valid: false,
      error: expect.stringContaining('Could not match Jira domain'),
    })
  })

  it.each([401, 403, 404, 500])(
    'classifies search HTTP %s without swallowing transient errors',
    async (status) => {
      fetchMock.mockResolvedValue(json({}, status))
      const error = await jiraConnector
        .listDocuments('token', SOURCE, undefined, { ...MEMBERS })
        .catch((value: unknown) => value)
      expect(error).toBeInstanceOf(Error)
      expect(jiraConnector.isCredentialInvalidError?.(error)).toBe(status === 401)
      expect(jiraConnector.isListingScopeUnavailableError?.(error)).toBe(status === 404)
    }
  )

  it('returns null for an issue removed between listing and retrieval', async () => {
    fetchMock.mockResolvedValue(json({}, 404))
    await expect(
      jiraConnector.getDocument('token', SOURCE, '10001', { cloudId: CLOUD_ID })
    ).resolves.toBeNull()
  })

  it('preserves deferred content, issue IDs, comments and hashes for ordinary knowledge bases', async () => {
    const payload = issue('10001', {
      comment: { comments: [{ body: adf('Existing KB comment') }], total: 1 },
    })
    fetchMock
      .mockResolvedValueOnce(json({ issues: [payload] }))
      .mockResolvedValueOnce(json(payload))
    const listed = await jiraConnector.listDocuments('token', SOURCE, undefined, {
      cloudId: CLOUD_ID,
    })
    const full = await jiraConnector.getDocument('token', SOURCE, '10001', { cloudId: CLOUD_ID })
    expect(listed.documents[0]).toMatchObject({
      externalId: '10001',
      content: '',
      contentDeferred: true,
    })
    expect(full?.content).toContain('Existing KB comment')
    expect(full?.contentHash).toBe(listed.documents[0]?.contentHash)
  })
})

import { createMockResponse } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AtlassianSiteNotMatchedError, clearAtlassianCloudIdCache } from '@/lib/atlassian/discovery'
import {
  beginListingCheckpoint,
  runResumableListing,
} from '@/lib/knowledge/connectors/listing-checkpoint'
import { jiraConnector } from '@/connectors/jira/jira'
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
  fetchMock.mockReset()
  clearAtlassianCloudIdCache()
  vi.stubGlobal('fetch', fetchMock)
})

describe('Jira Search member documents', () => {
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

  it('marks a provider-degraded result incomplete', async () => {
    fetchMock.mockResolvedValue(
      json({ issues: [issue()], warnings: [{ type: 'INGESTION_LIMIT' }] })
    )
    const context: Record<string, unknown> = { ...MEMBERS }
    await jiraConnector.listDocuments('token', SOURCE, undefined, context)
    expect(context.listingCapped).toBe(true)
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
})

describe('Jira member project permissions', () => {
  const source = { ...SOURCE, projectKey: ['ENG', 'SUPPORT'] }
  const projectDenied = {
    errorMessages: ["The value 'ENG' does not exist for the field 'project'."],
    errors: {},
  }
  const _supportIssue = (id: string) => issue(id, { project: { id: '20000', key: 'SUPPORT' } })

  it('confirms whole-source access loss only after every project has explicitly denied access', async () => {
    fetchMock
      .mockResolvedValueOnce(json(projectDenied, 400))
      .mockResolvedValueOnce(
        json(
          { errorMessages: ["The value 'SUPPORT' does not exist for the field 'project'."] },
          400
        )
      )
    const first = await jiraConnector.listDocuments('token', source, undefined, { ...MEMBERS })
    const error = await jiraConnector
      .listDocuments('token', source, first.nextCursor, { ...MEMBERS })
      .catch((value: unknown) => value)
    expect(jiraConnector.isListingScopeUnavailableError?.(error)).toBe(true)
  })

  it.each([
    { status: 400, body: { errorMessages: ['Invalid JQL syntax.'] } },
    {
      status: 400,
      body: { errorMessages: ["The value 'OTHER' does not exist for the field 'project'."] },
    },
    { status: 400, body: { errorMessages: [...projectDenied.errorMessages, 'Unknown field.'] } },
    { status: 400, body: { ...projectDenied, errors: { jql: 'Invalid query' } } },
    { status: 403, body: projectDenied },
    { status: 500, body: projectDenied },
  ])('preserves observations on unrelated failure %j', async ({ status, body }) => {
    fetchMock.mockResolvedValue(json(body, status))
    const error = await jiraConnector
      .listDocuments('token', source, undefined, { ...MEMBERS })
      .catch((value: unknown) => value)
    expect(error).toBeInstanceOf(Error)
    expect(jiraConnector.isListingScopeUnavailableError?.(error)).toBe(false)
    expect(jiraConnector.isListingCursorInvalidError?.(error)).toBe(false)
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fetchSource } = vi.hoisted(() => ({ fetchSource: vi.fn() }))
vi.mock('@/lib/knowledge/documents/secure-fetch.server', () => ({
  secureFetchWithRetry: fetchSource,
}))
vi.mock('@/lib/knowledge/documents/utils', () => ({ VALIDATE_RETRY_OPTIONS: {} }))
vi.mock('@/connectors/gitlab/permissions', () => ({
  getGitLabDocumentAcls: vi.fn(),
  openGitLabDirectory: vi.fn(),
  validateGitLabPermissionToken: vi.fn(),
}))

import { gitlabConnector } from '@/connectors/gitlab/gitlab'
import { gitlabConnectorMeta } from '@/connectors/gitlab/meta'
import { setGitLabCsvContext } from '@/connectors/gitlab/permission-config/types'
import type { ExternalDocument } from '@/connectors/types'

const HOST = 'https://gitlab.example.com:8443'
const PROJECT_PATH = '/api/v4/projects/group%2Fproject'
const config = { host: 'gitlab.example.com:8443', project: 'group/project', contentTypes: 'all' }
const issue = (iid = 1) => ({
  iid,
  title: `Issue ${iid}`,
  description: 'Investigate indexing',
  confidential: true,
  author: { id: 7, username: 'author' },
  assignees: [{ id: 8, username: 'assignee' }],
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-02T00:00:00Z',
  web_url: `${HOST}/group/project/-/issues/${iid}`,
})
const mr = (iid = 2) => ({
  ...issue(iid),
  title: `Merge request ${iid}`,
  description: 'Implement indexing',
  web_url: `${HOST}/group/project/-/merge_requests/${iid}`,
})
const note = (id: number, body = `Comment ${id}`) => ({
  id,
  body,
  system: false,
  internal: false,
  confidential: false,
  author: { id: 9, name: 'Reviewer' },
  created_at: '2026-08-03T00:00:00Z',
  updated_at: '2026-08-03T00:00:00Z',
})

interface SourceCall {
  url: URL
  headers: Record<string, string>
  maxResponseBytes?: number
}
let calls: SourceCall[]
let issues: ReturnType<typeof issue>[]
let merges: ReturnType<typeof mr>[]
let issueNotes: ReturnType<typeof note>[]
let mergeNotes: ReturnType<typeof note>[]
let wikiPages: { slug: string; title: string; content: string }[]
let override: ((call: SourceCall) => Response | undefined) | undefined

/** Provider fixture exercises complete multi-phase listing, pagination and hydration over a custom host. */
function respond(call: SourceCall): Response {
  const replacement = override?.(call)
  if (replacement) return replacement
  const { url } = call
  const resource = url.pathname.slice(PROJECT_PATH.length)
  if (!resource)
    return Response.json({ id: 42, path_with_namespace: 'group/project', default_branch: 'main' })
  const paginated = (items: unknown[]) => {
    const page = Number(url.searchParams.get('page') || 1)
    const next = new URL(url)
    next.searchParams.set('page', String(page + 1))
    return Response.json(items.slice(page - 1, page), {
      headers: page < items.length ? { Link: `<${next}>; rel="next"` } : {},
    })
  }
  if (resource === '/repository/tree') {
    return Response.json([
      { id: 'blobsha', name: 'readme.md', path: 'docs/readme.md', type: 'blob' },
    ])
  }
  if (resource.startsWith('/repository/files/')) {
    return Response.json({
      file_path: 'docs/readme.md',
      blob_id: 'blobsha',
      content: '# Readme',
      size: 8,
    })
  }
  if (resource === '/wikis') {
    return Response.json(wikiPages.map(({ slug, title }) => ({ slug, title })))
  }
  if (resource.startsWith('/wikis/')) {
    const page = wikiPages.find(
      (candidate) => candidate.slug === decodeURIComponent(resource.slice('/wikis/'.length))
    )
    return page ? Response.json(page) : new Response(null, { status: 404 })
  }
  if (resource === '/issues') return paginated(issues)
  if (resource === '/merge_requests') return paginated(merges)
  const match = resource.match(/^\/(issues|merge_requests)\/(\d+)(\/notes)?$/)
  if (match) {
    const collection = match[1] === 'issues' ? issues : merges
    const item = collection.find((candidate) => candidate.iid === Number(match[2]))
    if (!item) return new Response(null, { status: 404 })
    if (match[3]) return paginated(match[1] === 'issues' ? issueNotes : mergeNotes)
    return Response.json(item)
  }
  throw new Error(`No fixture for ${url.pathname}`)
}

async function list(
  sourceConfig: Record<string, unknown> = config,
  context: Record<string, unknown> = {}
): Promise<ExternalDocument[]> {
  const docs: ExternalDocument[] = []
  let cursor: string | undefined
  for (let page = 0; page < 30; page++) {
    const result = await gitlabConnector.listDocuments('pat', sourceConfig, cursor, context)
    docs.push(...result.documents)
    if (!result.hasMore) return docs
    if (!result.nextCursor) throw new Error('Missing continuation')
    cursor = result.nextCursor
  }
  throw new Error('Fixture listing did not finish')
}

async function hydrate(id: string) {
  const result = await gitlabConnector.getDocument('pat', config, id, {})
  if (!result) throw new Error('Fixture document was missing')
  return result
}

beforeEach(() => {
  calls = []
  issues = [issue(1), issue(3)]
  merges = [mr(2), mr(4)]
  issueNotes = [note(10, 'First discussion'), note(11, 'Second discussion')]
  mergeNotes = [
    note(20, 'Review comment'),
    { ...note(21, 'Do not expose internal'), internal: true },
    { ...note(22, 'Confidential note'), confidential: true },
    { ...note(23, 'System activity'), system: true },
  ]
  wikiPages = [{ slug: 'design/architecture', title: 'Architecture', content: 'Wiki body' }]
  override = undefined
  fetchSource.mockImplementation(async (raw: string, options: Omit<SourceCall, 'url'>) => {
    const call = { url: new URL(raw), ...options }
    calls.push(call)
    expect(call.url.origin).toBe(HOST)
    expect(call.headers['PRIVATE-TOKEN']).toBe('pat')
    return respond(call)
  })
})

describe('GitLab connector provider lifecycle', () => {
  it('refreshes comment edits and deletions even when parent timestamps do not change', async () => {
    const before = await hydrate('issue:1')
    const stable = await hydrate('issue:1')
    expect(stable.contentHash).toBe(before.contentHash)
    issueNotes[0].body = 'Edited discussion'
    const edited = await hydrate('issue:1')
    expect(edited.contentHash).not.toBe(before.contentHash)
    expect(edited.content).toContain('Edited discussion')
    issueNotes = []
    const deleted = await hydrate('issue:1')
    expect(deleted.contentHash).not.toBe(edited.contentHash)
    expect(deleted.content).not.toContain('discussion')
    expect(gitlabConnectorMeta.supportsIncrementalSync).toBe(false)
    const first = await list({ ...config, contentTypes: 'issues' }, { syncRunId: 'one' })
    const second = await list({ ...config, contentTypes: 'issues' }, { syncRunId: 'two' })
    expect(first[0].contentHash).not.toBe(second[0].contentHash)
    expect(calls.some((call) => call.url.searchParams.has('updated_after'))).toBe(false)
  })

  it('marks explicit caps incomplete so unseen documents are not reconciled away', async () => {
    const context: Record<string, unknown> = {}
    const docs = await list({ ...config, maxItems: 1 }, context)
    expect(docs).toHaveLength(1)
    expect(context.listingCapped).toBe(true)
  })

  it('keeps a listing incomplete when the cap leaves another provider page unread', async () => {
    const context: Record<string, unknown> = {}
    const docs = await list({ ...config, contentTypes: 'issues', maxItems: 1 }, context)
    expect(docs).toHaveLength(1)
    expect(context.listingCapped).toBe(true)
    expect(calls.filter((call) => call.url.pathname.endsWith('/issues'))).toHaveLength(1)
  })

  it('fails hydration if comment access changes or a continuation leaves the collection', async () => {
    override = ({ url }) =>
      url.pathname.endsWith('/notes') && url.searchParams.get('page') === '2'
        ? new Response(null, { status: 403 })
        : undefined
    await expect(hydrate('issue:1')).rejects.toThrow('comments: 403')
    override = ({ url }) =>
      url.pathname.endsWith('/notes')
        ? Response.json([note(1)], { headers: { Link: `<${HOST}/api/v4/users>; rel="next"` } })
        : undefined
    await expect(hydrate('issue:1')).rejects.toThrow('unexpected collection')
    expect(calls.some((call) => call.url.pathname === '/api/v4/users')).toBe(false)
  })

  it('excludes confidential and unknown-status issues before hydration in CSV mode', async () => {
    const context = { mirrorsSourceAcls: true }
    setGitLabCsvContext(context, {
      connectorId: 'csv-connector',
      host: 'gitlab.example.com:8443',
      projectId: 42,
      projectPath: 'group/project',
    })
    const listing = await gitlabConnector.listDocuments(
      'pat',
      { ...config, contentTypes: 'issues' },
      undefined,
      context
    )
    expect(listing.documents[0]).toMatchObject({
      title: 'Excluded GitLab issue',
      content: '',
      acl: [],
      skippedExistingDisposition: 'replace',
    })
    expect(JSON.stringify(listing.documents[0])).not.toContain('Investigate indexing')
    const hydrated = await gitlabConnector.getDocument('pat', config, 'issue:1', context)
    expect(hydrated).toMatchObject({ skippedExistingDisposition: 'replace', acl: [], content: '' })
    expect(calls.some((call) => call.url.pathname.endsWith('/notes'))).toBe(false)
  })

  it('revokes an issue that becomes confidential between listing and hydration', async () => {
    const context = { mirrorsSourceAcls: true }
    setGitLabCsvContext(context, {
      connectorId: 'csv-connector',
      host: 'gitlab.example.com:8443',
      projectId: 42,
      projectPath: 'group/project',
    })
    issues[0].confidential = false
    const listing = await gitlabConnector.listDocuments(
      'pat',
      { ...config, contentTypes: 'issues' },
      undefined,
      context
    )
    expect(listing.documents[0].skippedReason).toBeUndefined()
    issues[0].confidential = true
    expect(await gitlabConnector.getDocument('pat', config, 'issue:1', context)).toMatchObject({
      skippedExistingDisposition: 'replace',
      content: '',
      acl: [],
    })
    expect(calls.some((call) => call.url.pathname.endsWith('/notes'))).toBe(false)
  })

  it('does not trust CSV setup supplied through sourceConfig', async () => {
    const doc = await gitlabConnector.getDocument(
      'pat',
      { ...config, permissionConfig: { mode: 'csv' } },
      'issue:1',
      { mirrorsSourceAcls: true }
    )
    expect(doc?.skippedReason).toBeUndefined()
    expect(doc?.metadata?.confidential).toBe(true)
  })
})

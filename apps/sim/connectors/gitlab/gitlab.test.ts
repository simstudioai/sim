/** @vitest-environment node */
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
import type { ExternalDocument } from '@/connectors/types'
import { CONNECTOR_TEXT_DOCUMENT_MAX_BYTES } from '@/connectors/utils'

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
  vi.clearAllMocks()
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
  it('walks all phases and pages with stable resource namespaces and deferred bodies', async () => {
    const docs = await list()
    expect(docs.map((doc) => doc.externalId)).toEqual([
      'file:docs/readme.md',
      'wiki:design/architecture',
      'issue:1',
      'issue:3',
      'merge_request:2',
      'merge_request:4',
    ])
    expect(docs.every((doc) => doc.contentDeferred && doc.content === '')).toBe(true)
    expect(docs.find((doc) => doc.externalId === 'issue:1')?.metadata).toMatchObject({
      confidential: true,
      authorId: 7,
      assigneeIds: [8],
    })
    expect(
      calls
        .find((call) => call.url.pathname.endsWith('/wikis'))
        ?.url.searchParams.get('with_content')
    ).toBe('0')
    expect(
      calls
        .find((call) => call.url.pathname.endsWith('/merge_requests'))
        ?.url.searchParams.get('scope')
    ).toBe('all')
    expect(calls.filter((call) => call.url.pathname.endsWith('/merge_requests')).length).toBe(2)
  })

  it('preserves the legacy default of wiki plus issues and supports MR-only selection', async () => {
    expect((await list({ ...config, contentTypes: '' })).map((doc) => doc.externalId)).toEqual([
      'wiki:design/architecture',
      'issue:1',
      'issue:3',
    ])
    expect(
      (await list({ ...config, contentTypes: 'merge_requests' })).map((doc) => doc.externalId)
    ).toEqual(['merge_request:2', 'merge_request:4'])
  })

  it('hydrates parent text and all noninternal comments with precise note anchors', async () => {
    const doc = await hydrate('merge_request:2')
    expect(doc.content).toContain('Merge request 2\n\nImplement indexing')
    expect(doc.content).toContain('Review comment')
    expect(doc.content).toContain(`${HOST}/group/project/-/merge_requests/2#note_20`)
    expect(doc.content).not.toMatch(/Do not expose internal|Confidential note|System activity/)
    expect(doc.metadata?.contentType).toBe('merge_request')
    expect(calls.filter((call) => call.url.pathname.endsWith('/notes')).length).toBe(4)
    expect(calls.find((call) => call.url.pathname.endsWith('/notes'))?.maxResponseBytes).toBe(
      16 * 1024 * 1024
    )
  })

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

  it('preserves confidential issue metadata while hydrating comments', async () => {
    const doc = await hydrate('issue:1')
    expect(doc.metadata).toMatchObject({ confidential: true, authorId: 7, assigneeIds: [8] })
    expect(doc.content).toContain('First discussion')
    expect(doc.content).toContain('Second discussion')
    issues[0].confidential = false
    expect((await hydrate('issue:1')).metadata?.confidential).toBe(false)
  })

  it('hydrates wiki content separately and includes a title edit in its content hash', async () => {
    const first = await hydrate('wiki:design/architecture')
    expect(first.content).toBe('Architecture\n\nWiki body')
    wikiPages[0].title = 'New architecture'
    expect((await hydrate('wiki:design/architecture')).contentHash).not.toBe(first.contentHash)
    const doc = await hydrate('file:docs/readme.md')
    expect(doc.content).toContain('# Readme')
    expect(doc.contentHash).toBe('gitlab:file:group%2Fproject:docs/readme.md:blobsha')
  })

  it('honors server-supplied wiki continuations without inventing page support', async () => {
    override = ({ url }) => {
      if (!url.pathname.endsWith('/wikis')) return undefined
      if (url.searchParams.get('page') === '2')
        return Response.json([{ slug: 'second', title: 'Second' }])
      const next = new URL(url)
      next.searchParams.set('page', '2')
      return Response.json([{ slug: 'first', title: 'First' }], {
        headers: { Link: `<${next}>; rel="next"` },
      })
    }
    expect((await list({ ...config, contentTypes: 'wiki' })).map((doc) => doc.externalId)).toEqual([
      'wiki:first',
      'wiki:second',
    ])
  })

  it('marks explicit caps incomplete so unseen documents are not reconciled away', async () => {
    const context: Record<string, unknown> = {}
    const docs = await list({ ...config, maxItems: 1 }, context)
    expect(docs).toHaveLength(1)
    expect(context.listingCapped).toBe(true)
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

  it('rejects malformed and repeating comments instead of indexing partial content', async () => {
    override = ({ url }) =>
      url.pathname.endsWith('/notes')
        ? Response.json([{ id: 1, body: 'Missing visibility metadata' }])
        : undefined
    await expect(hydrate('issue:1')).rejects.toThrow('invalid comment')
    override = ({ url }) =>
      url.pathname.endsWith('/notes') ? Response.json([note(1), note(1)]) : undefined
    await expect(hydrate('issue:1')).rejects.toThrow('repeated a comment')
    override = ({ url }) =>
      url.pathname.endsWith('/notes')
        ? Response.json([note(1)], { headers: { Link: `<${url}>; rel="next"` } })
        : undefined
    await expect(hydrate('issue:1')).rejects.toThrow('repeated a pagination cursor')
  })

  it('rejects malformed parent collections and oversized comment content', async () => {
    override = ({ url }) =>
      url.pathname.endsWith('/issues') ? Response.json([{ title: 'Missing ID' }]) : undefined
    await expect(list({ ...config, contentTypes: 'issues' })).rejects.toThrow('invalid issue')
    override = undefined
    issueNotes = [note(1, 'x'.repeat(CONNECTOR_TEXT_DOCUMENT_MAX_BYTES))]
    await expect(hydrate('issue:1')).rejects.toThrow('size limit')
  })

  it('returns null for confirmed missing parents but surfaces listing authorization failures', async () => {
    expect(await gitlabConnector.getDocument('pat', config, 'merge_request:999', {})).toBeNull()
    expect(await gitlabConnector.getDocument('pat', config, 'issue:1.2', {})).toBeNull()
    override = ({ url }) =>
      url.pathname.endsWith('/merge_requests') ? new Response(null, { status: 403 }) : undefined
    await expect(list({ ...config, contentTypes: 'merge_requests' })).rejects.toThrow(
      'merge requests: 403'
    )
  })
})

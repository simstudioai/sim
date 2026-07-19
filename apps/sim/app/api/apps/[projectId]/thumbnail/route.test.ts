/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAssertAppPermission, mockGetSession, mockReadArtifactFile, selectResults } = vi.hoisted(
  () => ({
    mockAssertAppPermission: vi.fn(),
    mockGetSession: vi.fn(),
    mockReadArtifactFile: vi.fn(),
    selectResults: [] as unknown[][],
  })
)

function queryBuilder(rows: unknown[]) {
  const builder = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(async () => rows),
  }
  builder.from.mockReturnValue(builder)
  builder.where.mockReturnValue(builder)
  builder.orderBy.mockReturnValue(builder)
  return builder
}

vi.mock('@sim/db', () => ({
  db: {
    select: vi.fn(() => queryBuilder(selectResults.shift() ?? [])),
  },
}))
vi.mock('@sim/db/schema', () => ({
  appBuild: {
    artifactManifestHash: 'artifactManifestHash',
    createdAt: 'createdAt',
    projectId: 'projectId',
    revisionId: 'revisionId',
    status: 'status',
  },
  appProject: {
    archivedAt: 'archivedAt',
    draftRevisionId: 'draftRevisionId',
    id: 'id',
    publishedReleaseId: 'publishedReleaseId',
    workspaceId: 'workspaceId',
  },
  appRelease: {
    artifactManifestHash: 'artifactManifestHash',
    id: 'id',
    projectId: 'projectId',
    revokedAt: 'revokedAt',
    state: 'state',
  },
}))
vi.mock('drizzle-orm', () => ({
  and: vi.fn(),
  desc: vi.fn(),
  eq: vi.fn(),
  isNotNull: vi.fn(),
  isNull: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ getSession: mockGetSession }))
vi.mock('@/lib/apps/permissions', () => ({ assertAppPermission: mockAssertAppPermission }))
vi.mock('@/lib/apps/artifacts/store', () => ({ readArtifactFile: mockReadArtifactFile }))

import { GET, requestAcceptsEtag } from '@/app/api/apps/[projectId]/thumbnail/route'

function request(headers?: HeadersInit) {
  return new NextRequest('http://localhost/api/apps/project-1/thumbnail', { headers })
}

const context = { params: Promise.resolve({ projectId: 'project-1' }) }

describe('GET /api/apps/[projectId]/thumbnail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    selectResults.length = 0
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockAssertAppPermission.mockResolvedValue({ ok: true })
  })

  it('prefers the draft artifact and falls back to the published release', async () => {
    selectResults.push(
      [
        {
          id: 'project-1',
          workspaceId: 'workspace-1',
          draftRevisionId: 'revision-1',
          publishedReleaseId: 'release-1',
        },
      ],
      [{ artifactManifestHash: `sha256:${'a'.repeat(64)}` }],
      [{ artifactManifestHash: `sha256:${'b'.repeat(64)}` }]
    )
    const content = Buffer.from('webp')
    mockReadArtifactFile.mockResolvedValueOnce(null).mockResolvedValueOnce({
      content,
      contentType: 'image/webp',
      etag: `"${'c'.repeat(64)}"`,
    })

    const response = await GET(request(), context)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/webp')
    expect(response.headers.get('cache-control')).toBe('private, max-age=300')
    expect(response.headers.get('etag')).toBe(`"${'c'.repeat(64)}"`)
    expect(Buffer.from(await response.arrayBuffer())).toEqual(content)
    expect(mockReadArtifactFile).toHaveBeenNthCalledWith(
      1,
      `sha256:${'a'.repeat(64)}`,
      'preview.webp'
    )
    expect(mockReadArtifactFile).toHaveBeenNthCalledWith(
      2,
      `sha256:${'b'.repeat(64)}`,
      'preview.webp'
    )
  })

  it('returns a private 304 for a matching ETag', async () => {
    selectResults.push(
      [
        {
          id: 'project-1',
          workspaceId: 'workspace-1',
          draftRevisionId: 'revision-1',
          publishedReleaseId: null,
        },
      ],
      [{ artifactManifestHash: `sha256:${'a'.repeat(64)}` }]
    )
    const etag = `"${'c'.repeat(64)}"`
    mockReadArtifactFile.mockResolvedValue({
      content: Buffer.from('webp'),
      contentType: 'image/webp',
      etag,
    })

    const response = await GET(request({ 'if-none-match': `W/${etag}` }), context)

    expect(response.status).toBe(304)
    expect(response.headers.get('etag')).toBe(etag)
    expect(response.headers.get('cache-control')).toBe('private, max-age=300')
  })

  it('returns an empty, non-cacheable 404 when no thumbnail exists', async () => {
    selectResults.push([
      {
        id: 'project-1',
        workspaceId: 'workspace-1',
        draftRevisionId: null,
        publishedReleaseId: null,
      },
    ])

    const response = await GET(request(), context)

    expect(response.status).toBe(404)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.text()).toBe('')
  })

  it('checks workspace permission before resolving artifacts', async () => {
    selectResults.push([
      {
        id: 'project-1',
        workspaceId: 'workspace-1',
        draftRevisionId: 'revision-1',
        publishedReleaseId: 'release-1',
      },
    ])
    mockAssertAppPermission.mockResolvedValue({
      ok: false,
      status: 403,
      message: 'Write permission required',
    })

    const response = await GET(request(), context)

    expect(response.status).toBe(403)
    expect(mockAssertAppPermission).toHaveBeenCalledWith('user-1', 'workspace-1', 'edit')
    expect(mockReadArtifactFile).not.toHaveBeenCalled()
    expect(selectResults).toHaveLength(0)
  })
})

describe('requestAcceptsEtag', () => {
  it('accepts weak and list validators', () => {
    expect(requestAcceptsEtag('W/"old", "current"', '"current"')).toBe(true)
    expect(requestAcceptsEtag('"old"', '"current"')).toBe(false)
  })
})

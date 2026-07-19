import { beforeEach, describe, expect, it, vi } from 'vitest'

const { selectResults, distinctResults } = vi.hoisted(() => ({
  selectResults: [] as unknown[][],
  distinctResults: [] as unknown[][],
}))

function queryBuilder(rows: unknown[]) {
  const builder = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(async () => rows),
  }
  builder.from.mockReturnValue(builder)
  builder.where.mockReturnValue(builder)
  return builder
}

vi.mock('@sim/db', () => ({
  db: {
    select: vi.fn(() => queryBuilder(selectResults.shift() ?? [])),
    selectDistinctOn: vi.fn(() => queryBuilder(distinctResults.shift() ?? [])),
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
    updatedAt: 'updatedAt',
    workspaceId: 'workspaceId',
  },
  appRelease: {},
}))
vi.mock('drizzle-orm', () => ({
  and: vi.fn(),
  desc: vi.fn(),
  eq: vi.fn(),
  inArray: vi.fn(),
  isNull: vi.fn(),
}))

import { deriveAppInterfaceStatus, listAppProjects } from '@/lib/apps/projects'

beforeEach(() => {
  vi.clearAllMocks()
  selectResults.length = 0
  distinctResults.length = 0
})

describe('deriveAppInterfaceStatus', () => {
  const build = {
    projectId: 'project-1',
    revisionId: 'revision-1',
    artifactManifestHash: null,
  }

  it('maps the current draft build lifecycle to gallery states', () => {
    expect(
      deriveAppInterfaceStatus('revision-1', {
        ...build,
        status: 'queued',
      })
    ).toBe('building')
    expect(
      deriveAppInterfaceStatus('revision-1', {
        ...build,
        status: 'running',
      })
    ).toBe('building')
    expect(
      deriveAppInterfaceStatus('revision-1', {
        ...build,
        status: 'failed',
      })
    ).toBe('failed')
    expect(
      deriveAppInterfaceStatus('revision-1', {
        ...build,
        status: 'succeeded',
      })
    ).toBe('ready')
  })

  it('does not show a stale revision build as the current interface', () => {
    expect(
      deriveAppInterfaceStatus('revision-2', {
        ...build,
        status: 'succeeded',
      })
    ).toBe('empty')
    expect(deriveAppInterfaceStatus(null)).toBe('empty')
  })
})

describe('listAppProjects', () => {
  it('adds current interface state and a static thumbnail route', async () => {
    selectResults.push([
      {
        id: 'project-1',
        workspaceId: 'workspace-1',
        name: 'App',
        draftRevisionId: 'revision-1',
        publishedReleaseId: null,
      },
    ])
    distinctResults.push(
      [
        {
          projectId: 'project-1',
          revisionId: 'revision-1',
          status: 'running',
          artifactManifestHash: null,
        },
      ],
      [
        {
          projectId: 'project-1',
          revisionId: 'revision-1',
          status: 'succeeded',
          artifactManifestHash: `sha256:${'a'.repeat(64)}`,
        },
      ]
    )

    await expect(listAppProjects('workspace-1')).resolves.toEqual([
      expect.objectContaining({
        id: 'project-1',
        interfaceStatus: 'building',
        thumbnailUrl: `/api/apps/project-1/thumbnail?v=${encodeURIComponent(`sha256:${'a'.repeat(64)}`)}`,
      }),
    ])
  })
})

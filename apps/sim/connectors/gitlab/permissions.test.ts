/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fetchSource } = vi.hoisted(() => ({ fetchSource: vi.fn() }))
vi.mock('@/lib/knowledge/documents/secure-fetch.server', () => ({
  secureFetchWithRetry: fetchSource,
}))
vi.mock('@/lib/knowledge/documents/utils', () => ({ VALIDATE_RETRY_OPTIONS: {} }))

import {
  type GitLabPermissionProject,
  type GitLabPermissionUser,
  getGitLabDocumentAcls,
  gitLabFeatureAudience,
  openGitLabDirectory,
  validateGitLabPermissionToken,
} from '@/connectors/gitlab/permissions'
import type { ExternalDocument } from '@/connectors/types'

const project: GitLabPermissionProject = {
  id: 42,
  visibility: 'private',
  repository_access_level: 'enabled',
  merge_requests_access_level: 'enabled',
  wiki_access_level: 'enabled',
  issues_access_level: 'enabled',
  namespace: { kind: 'user', id: 1 },
  shared_with_groups: [],
}
const people: GitLabPermissionUser[] = [
  {
    id: 1,
    email: 'Admin@example.com',
    state: 'active',
    confirmed_at: '2025-01-01',
    is_admin: true,
    external: false,
  },
  {
    id: 2,
    email: 'reporter@example.com',
    state: 'active',
    confirmed_at: '2025-01-01',
    external: false,
  },
  {
    id: 3,
    email: 'guest@example.com',
    state: 'active',
    confirmed_at: '2025-01-01',
    external: false,
  },
  {
    id: 4,
    email: 'outsider@example.com',
    state: 'active',
    confirmed_at: '2025-01-01',
    external: true,
  },
  {
    id: 5,
    email: 'blocked@example.com',
    state: 'blocked',
    confirmed_at: '2025-01-01',
    is_admin: true,
  },
  { id: 6, email: 'unconfirmed@example.com', state: 'active', confirmed_at: null },
]
const members = [
  { id: 1, access_level: 50, state: 'active' },
  { id: 2, access_level: 20, state: 'active' },
  { id: 3, access_level: 10, state: 'active' },
  { id: 5, access_level: 50, state: 'active' },
  { id: 6, access_level: 50, state: 'active' },
]
const config = { host: 'gitlab.example.com:8443', project: 'group/project' }
let sourceProject = project

function document(id: string, metadata?: Record<string, unknown>): ExternalDocument {
  return {
    externalId: id,
    title: id,
    content: '',
    contentHash: id,
    mimeType: 'text/plain',
    metadata,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  sourceProject = project
  fetchSource.mockImplementation(async (raw: string) => {
    const url = new URL(raw)
    if (url.pathname === '/api/v4/user') return Response.json(people[0])
    if (url.pathname === '/api/v4/users') return Response.json(people)
    if (url.pathname === '/api/v4/version') return Response.json({ version: '18.7.0' })
    if (url.pathname === '/api/v4/application/settings')
      return Response.json({
        admin_mode: false,
        external_authorization_service_enabled: false,
      })
    if (url.pathname.endsWith('/members/all')) return Response.json(members)
    if (url.pathname.startsWith('/api/v4/projects/')) return Response.json(sourceProject)
    throw new Error(`Unexpected source request ${url.pathname}`)
  })
})

describe('GitLab source permission audiences', () => {
  it('distinguishes repository, ordinary issue and confidential issue access', () => {
    expect(gitLabFeatureAudience(project, people, members, 'repository')).toEqual([
      'admin@example.com',
      'reporter@example.com',
    ])
    expect(gitLabFeatureAudience(project, people, members, 'issues')).toEqual([
      'admin@example.com',
      'guest@example.com',
      'reporter@example.com',
    ])
    expect(gitLabFeatureAudience(project, people, members, 'confidential_issues')).toEqual([
      'admin@example.com',
      'reporter@example.com',
    ])
  })

  it('keeps internal visibility limited to confirmed non-external users', () => {
    expect(
      gitLabFeatureAudience({ ...project, visibility: 'internal' }, people, [], 'repository')
    ).toEqual(['admin@example.com', 'guest@example.com', 'reporter@example.com'])
    expect(
      gitLabFeatureAudience(
        { ...project, visibility: 'internal', repository_access_level: 'private' },
        people,
        [],
        'repository'
      )
    ).toEqual([])
  })

  it('withdraws expired memberships and refuses disabled or unknown features', () => {
    const expired = members.map((member) => ({ ...member, expires_at: '2025-01-01' }))
    expect(
      gitLabFeatureAudience(project, people, expired, 'issues', new Date('2025-01-02'))
    ).toEqual([])
    expect(
      gitLabFeatureAudience(
        { ...project, issues_access_level: 'disabled' },
        people,
        members,
        'issues'
      )
    ).toEqual([])
    expect(
      gitLabFeatureAudience(
        { ...project, issues_access_level: undefined },
        people,
        members,
        'issues'
      )
    ).toEqual([])
  })

  it('refuses a regular token instead of trusting public profile email', async () => {
    fetchSource.mockResolvedValue(Response.json(people[1]))
    await expect(validateGitLabPermissionToken('test-token', config)).rejects.toThrow(
      'instance administrator'
    )
  })

  it('uses project-scoped directory identities so one project cannot prune another', async () => {
    const directory = await openGitLabDirectory('test-token', config)
    expect(directory.tenantId).toBe('gitlab.example.com%3A8443/42')
    const groups = await directory.listGroups()
    const wiki = await directory.listGroupMembers(groups[1])
    expect(wiki.complete).toBe(true)
    expect(wiki.memberTokens).toEqual([
      'u:admin@example.com',
      'u:guest@example.com',
      'u:reporter@example.com',
    ])
    for (const [url, options] of fetchSource.mock.calls) {
      expect(new URL(url).origin).toBe('https://gitlab.example.com:8443')
      expect(options.headers['PRIVATE-TOKEN']).toBe('test-token')
    }
  })

  it('checks merge-request feature access separately from repository access', async () => {
    expect(
      gitLabFeatureAudience(
        { ...project, repository_access_level: 'disabled' },
        people,
        members,
        'merge_requests'
      )
    ).toEqual([])
    expect(
      gitLabFeatureAudience(
        { ...project, visibility: 'public', repository_access_level: 'private' },
        people,
        [],
        'merge_requests'
      )
    ).toEqual([])
    expect(
      gitLabFeatureAudience(
        { ...project, merge_requests_access_level: 'disabled' },
        people,
        members,
        'merge_requests'
      )
    ).toEqual([])
    expect(
      gitLabFeatureAudience(
        { ...project, visibility: 'public', merge_requests_access_level: 'private' },
        people,
        [],
        'merge_requests'
      )
    ).toEqual([])
    const acls = await getGitLabDocumentAcls('test-token', config, [
      document('merge_request:7', { authorId: 2 }),
    ])
    expect(acls['merge_request:7']).toEqual([
      'g:gitlab:gitlab.example.com%3A8443/42:project:42:merge_requests',
    ])
  })

  it('loads directory permissions lazily and replaces an earlier content snapshot', async () => {
    const context = {}
    await getGitLabDocumentAcls('test-token', config, [document('file:README.md')], context)
    const directory = await openGitLabDirectory('test-token', config, context)
    expect(
      fetchSource.mock.calls.filter(([raw]) => new URL(raw).pathname === '/api/v4/users')
    ).toHaveLength(1)
    sourceProject = { ...project, wiki_access_level: 'disabled' }
    const groups = await directory.listGroups()
    expect((await directory.listGroupMembers(groups[1])).memberTokens).toEqual([])
    await getGitLabDocumentAcls('test-token', config, [document('file:README.md')], context)
    expect(
      fetchSource.mock.calls.filter(([raw]) => new URL(raw).pathname === '/api/v4/users')
    ).toHaveLength(2)
    const next = await openGitLabDirectory('test-token', config, {})
    await next.listGroups()
    expect(
      fetchSource.mock.calls.filter(([raw]) => new URL(raw).pathname === '/api/v4/users')
    ).toHaveLength(3)
  })

  it('rejects a project path reassigned between directory identity and permission reads', async () => {
    const directory = await openGitLabDirectory('test-token', config, {})
    sourceProject = { ...project, id: 43 }
    await expect(directory.listGroups()).rejects.toThrow('project identity changed')
  })

  it('requires ordinary issue access before granting confidential author or assignee exceptions', async () => {
    const acls = await getGitLabDocumentAcls('test-token', config, [
      document('issue:1', { confidential: true, authorId: 3, assigneeIds: [4, 5] }),
      document('issue:2', { confidential: false, authorId: 2 }),
      document('issue:3'),
      document('file:README.md'),
    ])
    expect(acls['issue:1']).toEqual([
      'g:gitlab:gitlab.example.com%3A8443/42:project:42:confidential_issues',
      'u:guest@example.com',
    ])
    expect(acls['issue:2']).toEqual(['g:gitlab:gitlab.example.com%3A8443/42:project:42:issues'])
    expect(acls['issue:3']).toEqual([])
    expect(acls['file:README.md']).toEqual([
      'g:gitlab:gitlab.example.com%3A8443/42:project:42:repository',
    ])
  })

  it('allows a public-project author exception until its issue feature becomes members-only', async () => {
    sourceProject = { ...project, visibility: 'public' }
    const item = document('issue:1', { confidential: true, authorId: 4 })
    const publicAcl = await getGitLabDocumentAcls('test-token', config, [item])
    expect(publicAcl['issue:1']).toContain('u:outsider@example.com')
    sourceProject = { ...sourceProject, issues_access_level: 'private' }
    const privateAcl = await getGitLabDocumentAcls('test-token', config, [item])
    expect(privateAcl['issue:1']).not.toContain('u:outsider@example.com')
  })

  it('hides banned-author work items while preserving blocked and deleted-author content', async () => {
    fetchSource.mockImplementation(async (raw: string) => {
      const url = new URL(raw)
      if (url.pathname === '/api/v4/user') return Response.json(people[0])
      if (url.pathname === '/api/v4/users') {
        expect(url.searchParams.has('active')).toBe(false)
        return Response.json([
          ...people,
          { id: 7, state: 'banned' },
          { id: 8, state: 'active', name: 'Ghost' },
        ])
      }
      if (url.pathname === '/api/v4/version') return Response.json({ version: '18.7.0' })
      if (url.pathname === '/api/v4/application/settings')
        return Response.json({
          admin_mode: false,
          external_authorization_service_enabled: false,
        })
      if (url.pathname.endsWith('/members/all')) return Response.json(members)
      if (url.pathname.startsWith('/api/v4/projects/')) return Response.json(project)
      throw new Error(`Unexpected source request ${url.pathname}`)
    })
    const acls = await getGitLabDocumentAcls('test-token', config, [
      document('issue:7', { confidential: false, authorId: 7 }),
      document('merge_request:7', { authorId: 7 }),
      document('issue:5', { confidential: false, authorId: 5 }),
      document('issue:8', { confidential: false, authorId: 8 }),
      document('issue:9', { confidential: false }),
      document('merge_request:9', { authorId: 99 }),
    ])
    expect(acls['issue:7']).toEqual(['u:admin@example.com'])
    expect(acls['merge_request:7']).toEqual(['u:admin@example.com'])
    expect(acls['issue:5']).toEqual(['g:gitlab:gitlab.example.com%3A8443/42:project:42:issues'])
    expect(acls['issue:8']).toEqual(acls['issue:5'])
    expect(acls['issue:9']).toEqual([])
    expect(acls['merge_request:9']).toEqual([])
  })

  it('does not infer administrator bypass when the instance uses admin mode', () => {
    expect(gitLabFeatureAudience(project, people, [], 'repository')).toEqual([])
    expect(
      gitLabFeatureAudience(project, people, [], 'repository', new Date(), {
        implicitAdmin: true,
        plannerCanReadCode: true,
      })
    ).toEqual(['admin@example.com'])
  })

  it('applies versioned Planner access separately from the members-only feature gate', () => {
    const planners = [{ id: 3, access_level: 15, state: 'active' }]
    expect(gitLabFeatureAudience(project, people, planners, 'repository')).toEqual([])
    const policy = { implicitAdmin: false, plannerCanReadCode: true }
    expect(
      gitLabFeatureAudience(project, people, planners, 'repository', new Date(), policy)
    ).toEqual(['guest@example.com'])
    expect(
      gitLabFeatureAudience(
        { ...project, repository_access_level: 'private' },
        people,
        planners,
        'repository',
        new Date(),
        policy
      )
    ).toEqual(['guest@example.com'])
  })

  it.each(['public', 'internal'] as const)(
    'requires membership for private features on a %s project without dropping valid Guest repository access',
    (visibility) => {
      const source = {
        ...project,
        visibility,
        repository_access_level: 'private',
        merge_requests_access_level: 'private',
      }
      expect(gitLabFeatureAudience(source, people, members, 'repository')).toEqual([
        'admin@example.com',
        'guest@example.com',
        'reporter@example.com',
      ])
      expect(gitLabFeatureAudience(source, people, members, 'merge_requests')).toEqual([
        'admin@example.com',
        'reporter@example.com',
      ])
      expect(gitLabFeatureAudience(source, people, [], 'repository')).toEqual([])
      const externalGuest = [{ id: 4, access_level: 10, state: 'active' }]
      expect(gitLabFeatureAudience(source, people, externalGuest, 'repository')).toEqual(
        visibility === 'public' ? ['outsider@example.com'] : []
      )
    }
  )

  it('refuses incomplete and cross-origin permission pagination', async () => {
    fetchSource.mockImplementation(async (raw: string) => {
      if (new URL(raw).pathname === '/api/v4/user') return Response.json(people[0])
      if (new URL(raw).pathname === '/api/v4/projects/group%2Fproject')
        return Response.json(project)
      return Response.json([], {
        headers: { link: '<https://attacker.example/api/v4/users?page=2>; rel="next"' },
      })
    })
    const directory = await openGitLabDirectory('test-token', config)
    await expect(directory.listGroups()).rejects.toThrow('changed its source')
  })
})

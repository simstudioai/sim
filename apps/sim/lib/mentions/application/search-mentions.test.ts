/**
 * @vitest-environment node
 *
 * One organization-wide read replaces a picker that read every family of every workspace itself.
 * Failure modes: a family its own operation refuses taking the rest of the workspace with it, a
 * failing workspace failing the whole search or vanishing silently, a workspace outside the
 * viewer's access being read, an `@` query returning more than its cap or ranking a weaker match
 * first, recents ignoring update order, a built-in skill listed once per workspace, and a folder
 * browse leaking rows from other folders.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationError } from '@/lib/core/orchestration/types'

const mocks = vi.hoisted(() => ({
  workspaces: vi.fn(),
  workflows: vi.fn(),
  skills: vi.fn(),
  chats: vi.fn(),
  tables: vi.fn(),
  searchFiles: vi.fn(),
  listFiles: vi.fn(),
  fileFolders: vi.fn(),
  knowledgeBases: vi.fn(),
  dashboard: vi.fn(),
  folders: vi.fn(),
  logs: vi.fn(),
}))

vi.mock('@/lib/core/application/organization-authorization', () => ({
  authorizeOrganizationOperation: async (
    principal: { userId: string },
    _operation: unknown,
    input: { organizationId: string }
  ) => ({ organizationId: input.organizationId, userId: principal.userId, role: 'member' }),
}))
vi.mock('@/lib/workspaces/utils', () => ({ listAccessibleWorkspaceRowsForUser: mocks.workspaces }))
vi.mock('@/lib/workflows/application/list-workflows', () => ({
  listWorkspaceWorkflowItemsUseCase: { execute: mocks.workflows },
}))
vi.mock('@/lib/skills/application/use-cases', () => ({
  listAvailableSkillsUseCase: { execute: mocks.skills },
}))
vi.mock('@/lib/workflows/skills/builtin-skills', () => ({
  isBuiltinSkillId: (id: string) => id.startsWith('builtin-'),
}))
vi.mock('@/lib/mothership/chat/application/use-cases', () => ({
  listWorkspaceChats: { execute: mocks.chats },
}))
vi.mock('@/lib/table/application/tables', () => ({
  listTableDefinitionsUseCase: { execute: mocks.tables },
}))
vi.mock('@/lib/workspace-files/application/list-workspace-files', () => ({
  searchWorkspaceFiles: { execute: mocks.searchFiles },
  listWorkspaceFileCollection: { execute: mocks.listFiles },
}))
vi.mock('@/lib/workspace-files/application/folders', () => ({
  listWorkspaceFileFoldersOperation: { execute: mocks.fileFolders },
}))
vi.mock('@/lib/knowledge/application/knowledge-bases', () => ({
  listInternalKnowledgeBases: { execute: mocks.knowledgeBases },
}))
vi.mock('@/lib/dashboards/application/dashboards', () => ({
  readWorkspaceDashboard: { execute: mocks.dashboard },
}))
vi.mock('@/lib/folders/application/list-folders', () => ({
  listWorkspaceFoldersUseCase: { execute: mocks.folders },
}))
vi.mock('@/lib/logs/application/list-logs', () => ({
  listLogsUseCase: { execute: mocks.logs },
}))

import { searchMentions } from '@/lib/mentions/application/search-mentions'

const principal = { kind: 'session', userId: 'viewer', sessionId: 'session-1' } as const

function workspaceRow(id: string, name: string, updatedAt = '2026-11-01T00:00:00.000Z') {
  return { workspace: { id, name, updatedAt: new Date(updatedAt) }, permissionType: 'read' }
}

const record = (id: string, name: string, updatedAt: string, extra = {}) => ({
  id,
  name,
  updatedAt,
  ...extra,
})

function search(input: Partial<Parameters<typeof searchMentions.execute>[0]['input']> = {}) {
  return searchMentions.execute({
    principal,
    input: { organizationId: 'org-1', query: '', limit: 20, ...input },
  })
}

beforeEach(() => {
  mocks.workspaces.mockResolvedValue([workspaceRow('ws-a', 'Alpha'), workspaceRow('ws-b', 'Beta')])
  mocks.workflows.mockImplementation(async ({ input }) =>
    input.workspaceId === 'ws-a'
      ? [
          record('wf-1', 'Invoice sync', '2026-11-03T00:00:00.000Z', { folderId: 'f-1' }),
          record('wf-2', 'Sync invoices', '2026-11-05T00:00:00.000Z', { folderId: null }),
          record('wf-3', 'Reports', '2026-11-04T00:00:00.000Z', { folderId: 'f-1' }),
        ]
      : [record('wf-4', 'Invoice', '2026-11-02T00:00:00.000Z', { folderId: null })]
  )
  mocks.skills.mockImplementation(async ({ input }) => ({
    skills: [
      record('builtin-research', 'Research', '2026-01-01T00:00:00.000Z', {
        description: 'Built in',
      }),
      record(`skill-${input.workspaceId}`, 'Own', '2026-01-01T00:00:00.000Z', {
        description: 'Mine',
      }),
    ],
  }))
  mocks.chats.mockResolvedValue([])
  mocks.tables.mockResolvedValue({ tables: [] })
  mocks.searchFiles.mockResolvedValue({ files: [] })
  mocks.listFiles.mockResolvedValue({ files: [] })
  mocks.fileFolders.mockResolvedValue({ folders: [] })
  mocks.knowledgeBases.mockResolvedValue({ knowledgeBases: [] })
  mocks.dashboard.mockResolvedValue({ dashboard: null })
  mocks.folders.mockResolvedValue([])
  mocks.logs.mockResolvedValue({ data: [] })
})

const names = (rows: { family: string; name: string }[], family: string) =>
  rows.filter((row) => row.family === family).map((row) => row.name)

describe('an @ query', () => {
  it('ranks exact, then prefix, then substring matches, across workspaces, within the cap', async () => {
    const result = await search({ query: 'invoice', limit: 2 })
    expect(names(result.rows, 'workflows')).toEqual(['Invoice', 'Invoice sync'])
  })

  it('offers the most recently updated rows when nothing is typed', async () => {
    const result = await search({ limit: 3 })
    expect(names(result.rows, 'workflows')).toEqual(['Sync invoices', 'Reports', 'Invoice sync'])
  })
})

describe('a family its own operation refuses', () => {
  it('is absent while the workspace keeps its other families', async () => {
    mocks.tables.mockRejectedValue(new OrchestrationError('forbidden', 'Tables are hidden'))
    const result = await search()
    expect(names(result.rows, 'tables')).toEqual([])
    expect(names(result.rows, 'workflows')).toHaveLength(4)
    expect(result.unavailableWorkspaces).toEqual([])
  })
})

describe('a workspace whose reads fail', () => {
  it('is reported as unavailable and every other workspace still answers', async () => {
    mocks.chats.mockImplementation(async ({ input }) => {
      if (input.workspaceId === 'ws-b') throw new Error('connection reset')
      return []
    })
    const result = await search()
    expect(result.unavailableWorkspaces).toEqual([{ id: 'ws-b', name: 'Beta' }])
    expect(names(result.rows, 'workflows')).toEqual(['Sync invoices', 'Reports', 'Invoice sync'])
  })
})

describe('browsing', () => {
  it('refuses a workspace outside the viewer access without reading it', async () => {
    await expect(search({ workspaceId: 'ws-other' })).rejects.toMatchObject({ code: 'not_found' })
    expect(mocks.workflows).not.toHaveBeenCalled()
  })

  it('lists only the families that have rows in the browsed workspace', async () => {
    const result = await search({ workspaceId: 'ws-b' })
    expect(result.families).toEqual(['workflows'])
    expect(names(result.rows, 'workflows')).toEqual(['Invoice'])
  })

  it('keeps a folder page to that folder', async () => {
    const result = await search({ workspaceId: 'ws-a', family: 'workflows', folderId: 'f-1' })
    expect(result.rows.map((row) => row.id)).toEqual(['wf-1', 'wf-3'])
  })

  it('lists a built-in skill once, apart from any workspace', async () => {
    const result = await search({ family: 'skills', limit: 100 })
    expect(result.rows.map((row) => [row.id, row.workspaceId])).toEqual([
      ['builtin-research', undefined],
      ['skill-ws-a', 'ws-a'],
      ['skill-ws-b', 'ws-b'],
    ])
  })
})

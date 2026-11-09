/**
 * @vitest-environment node
 *
 * The organization-wide mention read batches each family across workspaces, so the per-workspace
 * gates its families' own routes apply must hold inside it. Failure modes: a family read in a
 * workspace whose permission group withholds it, a workspace whose access cannot be read taking
 * the search down or vanishing silently, a failing family taking the others with it, a workspace
 * outside the viewer's access being read, dashboards read while switched off, and a browse page
 * that never reports its next page.
 */
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import {
  organizationAuthorizationMock,
  organizationAuthorizationMockFns,
} from '@sim/testing/mocks/organization-authorization.mock'
import {
  permissionGroupScopeMock,
  permissionGroupScopeMockFns,
} from '@sim/testing/mocks/permission-group-scope.mock'
import {
  workspacesUtilsMock,
  workspacesUtilsMockFns,
} from '@sim/testing/mocks/workspaces-utils.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MentionReadSpec, MentionRecord } from '@/lib/mentions/queries'
import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'

/** Seeded rows per family; each read returns only the workspaces it was given. */
const seeded = vi.hoisted(() => ({
  failing: new Set<string>(),
  rows: new Map<string, { id: string; name: string; workspaceId: string }[]>(),
}))

vi.mock('@/lib/core/application/organization-authorization', () => organizationAuthorizationMock)
vi.mock('@/lib/workspaces/utils', () => workspacesUtilsMock)
vi.mock('@/lib/permission-groups/config-scope.server', () => permissionGroupScopeMock)
vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)
vi.mock('@/lib/mentions/queries', () => {
  const reader = (family: string) => async (spec: MentionReadSpec) => {
    if (seeded.failing.has(family)) throw new Error('connection reset')
    const rows = (seeded.rows.get(family) ?? []).filter((row) =>
      spec.workspaceIds.includes(row.workspaceId)
    )
    const start = spec.page?.offset ?? 0
    return rows
      .slice(start, start + spec.limit)
      .map((row): MentionRecord => ({ ...row, updatedAt: new Date(0), parentId: null }))
  }
  return {
    readWorkflowMentions: reader('workflows'),
    readSkillMentions: reader('skills'),
    readChatMentions: reader('chats'),
    readTableMentions: reader('tables'),
    readFileMentions: reader('files'),
    readFileFolderMentions: reader('file_folders'),
    readKnowledgeBaseMentions: reader('knowledge_bases'),
    readDashboardMentions: reader('dashboards'),
    readFolderMentions: reader('folders'),
    readLogMentions: reader('logs'),
  }
})

import { searchMentions } from '@/lib/mentions/application/search-mentions'

const principal = { kind: 'session', userId: 'viewer', sessionId: 'session-1' } as const

function search(input: Partial<Parameters<typeof searchMentions.execute>[0]['input']> = {}) {
  return searchMentions.execute({
    principal,
    input: { organizationId: 'org-1', query: '', limit: 20, ...input },
  })
}

function seed(family: string, workspaceId: string, count = 1) {
  const rows = seeded.rows.get(family) ?? []
  for (let index = 0; index < count; index++)
    rows.push({ id: `${family}-${workspaceId}-${index}`, name: `${family} ${index}`, workspaceId })
  seeded.rows.set(family, rows)
}

const families = (result: Awaited<ReturnType<typeof search>>) => [
  ...new Set(result.rows.map((row) => `${row.family}@${row.workspaceId}`)),
]

beforeEach(() => {
  seeded.failing.clear()
  seeded.rows.clear()
  organizationAuthorizationMockFns.mockAuthorizeOrganizationOperation.mockImplementation(
    async (_principal: unknown, _operation: unknown, input: { organizationId: string }) => ({
      organizationId: input.organizationId,
      userId: 'viewer',
      role: 'member',
    })
  )
  workspacesUtilsMockFns.mockListAccessibleWorkspaceRowsForUser.mockResolvedValue([
    { workspace: { id: 'ws-a', name: 'Alpha', updatedAt: new Date(2) }, permissionType: 'read' },
    { workspace: { id: 'ws-b', name: 'Beta', updatedAt: new Date(1) }, permissionType: 'read' },
  ])
  permissionGroupScopeMockFns.mockResolvePermissionGroupConfig.mockResolvedValue(null)
  featureFlagsMockFns.mockIsFeatureEnabled.mockResolvedValue(true)
  for (const workspaceId of ['ws-a', 'ws-b']) {
    seed('tables', workspaceId)
    seed('workflows', workspaceId)
    seed('dashboards', workspaceId)
  }
})

describe('a family the permission group withholds', () => {
  it('is read only in the workspaces whose group leaves it', async () => {
    permissionGroupScopeMockFns.mockResolvePermissionGroupConfig.mockImplementation(
      async (_userId: string, workspaceId: string) =>
        workspaceId === 'ws-b' ? { ...DEFAULT_PERMISSION_GROUP_CONFIG, hideTablesTab: true } : null
    )
    const result = await search()
    expect(families(result)).toEqual(
      expect.arrayContaining(['tables@ws-a', 'workflows@ws-a', 'workflows@ws-b'])
    )
    expect(families(result)).not.toContain('tables@ws-b')
  })
})

describe('a workspace whose access cannot be read', () => {
  it('is reported and read for nothing while every other workspace answers', async () => {
    permissionGroupScopeMockFns.mockResolvePermissionGroupConfig.mockImplementation(
      async (_userId: string, workspaceId: string) => {
        if (workspaceId === 'ws-b') throw new Error('connection reset')
        return null
      }
    )
    const result = await search()
    expect(result.unavailableWorkspaces).toEqual([{ id: 'ws-b', name: 'Beta' }])
    expect(families(result).filter((entry) => entry.endsWith('@ws-b'))).toEqual(['workspaces@ws-b'])
    expect(families(result)).toContain('tables@ws-a')
  })
})

describe('a family whose read fails', () => {
  it('is reported while the other families stand', async () => {
    seeded.failing.add('tables')
    const result = await search()
    expect(result.unavailableFamilies).toEqual(['tables'])
    expect(families(result)).toContain('workflows@ws-a')
  })
})

describe('dashboards switched off for the organization', () => {
  it('are not read', async () => {
    featureFlagsMockFns.mockIsFeatureEnabled.mockResolvedValue(false)
    const result = await search()
    expect(result.rows.filter((row) => row.family === 'dashboards')).toEqual([])
  })
})

describe('browsing', () => {
  it('refuses a workspace outside the viewer access', async () => {
    await expect(search({ workspaceId: 'ws-other' })).rejects.toMatchObject({ code: 'not_found' })
  })

  it('pages a family to its end, reporting each next page', async () => {
    seed('workflows', 'ws-a', 4)
    const first = await search({ workspaceId: 'ws-a', family: 'workflows', limit: 3 })
    expect(first.rows).toHaveLength(3)
    expect(first.nextCursor).toBe('3')
    const second = await search({
      workspaceId: 'ws-a',
      family: 'workflows',
      limit: 3,
      cursor: first.nextCursor,
    })
    expect(second.rows.map((row) => row.id)).toEqual(['workflows-ws-a-2', 'workflows-ws-a-3'])
    expect(second.nextCursor).toBeUndefined()
  })

  it("lists a workspace's families with the cursor of any family past its first page", async () => {
    seed('files', 'ws-a', 3)
    const result = await search({ workspaceId: 'ws-a', limit: 2 })
    expect(result.families).toEqual(
      expect.arrayContaining([
        { family: 'tables', nextCursor: undefined },
        { family: 'files', nextCursor: '2' },
      ])
    )
  })
})

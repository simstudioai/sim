/**
 * @vitest-environment node
 *
 * One test per v2 list-backing query, asserting the same two things everywhere:
 * `search` becomes a bound case-insensitive substring predicate on that
 * resource's natural name column, and `sortBy` selects the ordering columns.
 *
 * This is the surface-wide guard the convention needs. `list-query.test.ts`
 * proves the generated SQL is parameterized and wildcard-escaped; what can still
 * go wrong per resource is aiming the search at the wrong column, or a sort that
 * never reaches `ORDER BY` — both visible only in the query each lib builds.
 *
 * Files (`queryWorkspaceFiles`) and workflows have their own suites, since they
 * additionally paginate.
 */
import {
  dbChainMockFns,
  flattenMockConditions,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/billing/core/subscription', () => ({ getHighestPrioritySubscription: vi.fn() }))
vi.mock('@/lib/billing/core/usage', () => ({ ensureUserStatsExists: vi.fn() }))
vi.mock('@/lib/billing/storage', () => ({
  applyStorageUsageDeltasInTx: vi.fn(),
  decrementStorageUsageForBillingContextInTx: vi.fn(),
  incrementStorageUsageForBillingContextInTx: vi.fn(),
  maybeNotifyStorageLimitForBillingContext: vi.fn(),
  resolveStorageBillingContext: vi.fn(),
}))
vi.mock('@/lib/table/billing', () => ({
  assertRowCapacity: vi.fn(),
  notifyTableRowUsage: vi.fn(),
}))
vi.mock('@/lib/table/jobs/service', () => ({
  EMPTY_JOB_FIELDS: {},
  latestNonExportJobJson: vi.fn(() => null),
  mapJobRow: vi.fn(() => ({})),
  latestJobsForTables: vi.fn(async () => new Map()),
}))
vi.mock('@/lib/table/events', () => ({ appendTableEvent: vi.fn() }))
vi.mock('@/lib/realtime/notify', () => ({
  mergeEditIntoLiveFileDoc: vi.fn(),
  notifyWorkspaceFilesChanged: vi.fn(),
  notifyWorkspaceTablesChanged: vi.fn(),
}))
vi.mock('@/lib/skills/access', () => ({ getEditableSkillIds: vi.fn() }))
vi.mock('@/lib/workflows/skills/builtin-skills', () => ({
  BUILTIN_SKILLS: [],
  getBuiltinSkillById: vi.fn(),
  isBuiltinSkillId: vi.fn(() => false),
}))

import { listVisibleWorkspaceCredentials } from '@/lib/credentials/queries'
import { listFoldersForWorkspace } from '@/lib/folders/queries'
import { getDocuments } from '@/lib/knowledge/documents/service'
import { getWorkspaceKnowledgeBases } from '@/lib/knowledge/service'
import { listWorkspaceMcpServers } from '@/lib/mcp/queries'
import { listTables } from '@/lib/table/service'
import { listWorkspaceCustomTools } from '@/lib/workflows/custom-tools/operations'
import { listSkills } from '@/lib/workflows/skills/operations'

const WS = 'workspace-1'

const lastConditions = () =>
  flattenMockConditions(dbChainMockFns.where.mock.calls.at(-1)?.[0]).filter(Boolean)

const lastOrderBy = () => dbChainMockFns.orderBy.mock.calls.at(-1) ?? []

const searchNode = () => lastConditions().find((c) => c.type === 'ilike')

interface ListCase {
  name: string
  /** Column the resource's `search` must match on. */
  column: unknown
  /** Rows table to queue against, so the chain resolves. */
  table: unknown
  run: (options: {
    search?: string
    sortBy?: string
    sortOrder?: 'asc' | 'desc'
  }) => Promise<unknown>
  /** A non-default sort, and the columns it must order by. */
  sort: { sortBy: string; sortOrder: 'asc' | 'desc'; columns: unknown[] }
}

const CASES: ListCase[] = [
  {
    name: 'folders',
    column: schemaMock.folder.name,
    table: schemaMock.folder,
    run: ({ search, sortBy, sortOrder }) =>
      listFoldersForWorkspace(WS, 'active', 'workflow', {
        search,
        sortBy: sortBy as never,
        sortOrder,
      }),
    sort: {
      sortBy: 'name',
      sortOrder: 'desc',
      columns: [schemaMock.folder.name, schemaMock.folder.createdAt],
    },
  },
  {
    name: 'tables',
    column: schemaMock.userTableDefinitions.name,
    table: schemaMock.userTableDefinitions,
    run: ({ search, sortBy, sortOrder }) =>
      listTables(WS, { search, sortBy: sortBy as never, sortOrder }),
    sort: {
      sortBy: 'updatedAt',
      sortOrder: 'desc',
      columns: [
        schemaMock.userTableDefinitions.updatedAt,
        schemaMock.userTableDefinitions.createdAt,
      ],
    },
  },
  {
    name: 'knowledge bases',
    column: schemaMock.knowledgeBase.name,
    table: schemaMock.knowledgeBase,
    run: ({ search, sortBy, sortOrder }) =>
      getWorkspaceKnowledgeBases(WS, 'active', { search, sortBy: sortBy as never, sortOrder }),
    sort: {
      sortBy: 'name',
      sortOrder: 'asc',
      columns: [schemaMock.knowledgeBase.name, schemaMock.knowledgeBase.id],
    },
  },
  {
    name: 'credentials',
    column: schemaMock.credential.displayName,
    table: schemaMock.credential,
    run: ({ search, sortBy, sortOrder }) =>
      listVisibleWorkspaceCredentials({
        workspaceId: WS,
        userId: 'user-1',
        workspaceAccess: { canAdmin: false },
        search,
        sortBy: sortBy as never,
        sortOrder,
      }),
    sort: {
      sortBy: 'displayName',
      sortOrder: 'asc',
      columns: [schemaMock.credential.displayName, schemaMock.credential.id],
    },
  },
  {
    name: 'MCP servers',
    column: schemaMock.mcpServers.name,
    table: schemaMock.mcpServers,
    run: ({ search, sortBy, sortOrder }) =>
      listWorkspaceMcpServers({ workspaceId: WS, search, sortBy: sortBy as never, sortOrder }),
    sort: {
      sortBy: 'name',
      sortOrder: 'asc',
      columns: [schemaMock.mcpServers.name, schemaMock.mcpServers.id],
    },
  },
  {
    name: 'custom tools',
    column: schemaMock.customTools.title,
    table: schemaMock.customTools,
    run: ({ search, sortBy, sortOrder }) =>
      listWorkspaceCustomTools({ workspaceId: WS, search, sortBy: sortBy as never, sortOrder }),
    sort: {
      sortBy: 'title',
      sortOrder: 'asc',
      columns: [schemaMock.customTools.title, schemaMock.customTools.id],
    },
  },
  {
    name: 'knowledge documents',
    column: schemaMock.document.filename,
    table: schemaMock.document,
    run: ({ search, sortBy, sortOrder }) =>
      getDocuments(
        'knowledge-1',
        { search, sortBy: sortBy as never, sortOrder: sortOrder as never },
        'request-1'
      ),
    sort: {
      sortBy: 'fileSize',
      sortOrder: 'asc',
      columns: [schemaMock.document.fileSize, schemaMock.document.filename],
    },
  },
  {
    name: 'skills',
    column: schemaMock.skill.name,
    table: schemaMock.skill,
    run: ({ search, sortBy, sortOrder }) =>
      listSkills({
        workspaceId: WS,
        search,
        sort: sortBy ? { sortBy: sortBy as never, sortOrder: sortOrder ?? 'desc' } : undefined,
      }),
    sort: {
      sortBy: 'name',
      sortOrder: 'asc',
      columns: [schemaMock.skill.name, schemaMock.skill.id],
    },
  },
]

describe.each(CASES)('$name list query', (listCase) => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    queueTableRows(listCase.table, [])
  })

  it('narrows the query with a case-insensitive substring match on its name column', async () => {
    await listCase.run({ search: 'quarterly' })

    expect(searchNode()).toMatchObject({ column: listCase.column, pattern: '%quarterly%' })
  })

  it('escapes LIKE wildcards so a caller cannot widen its own match', async () => {
    await listCase.run({ search: '50%_off' })

    expect(searchNode()).toMatchObject({ pattern: '%50\\%\\_off%' })
  })

  it('adds no search condition when the caller did not search', async () => {
    await listCase.run({})

    expect(searchNode()).toBeUndefined()
  })

  it('orders by the requested field and direction', async () => {
    const { sortBy, sortOrder, columns } = listCase.sort

    await listCase.run({ sortBy, sortOrder })

    expect(lastOrderBy()).toEqual(columns.map((column) => ({ type: sortOrder, column })))
  })
})

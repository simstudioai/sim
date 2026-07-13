/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { loggerInfo, loggerWarn, mockSql } = vi.hoisted(() => {
  const taggedSql = Object.assign(
    vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })),
    {
      join: vi.fn((chunks: unknown[], separator: unknown) => ({ chunks, separator })),
      raw: vi.fn((value: string) => ({ raw: value })),
    }
  )
  return {
    loggerInfo: vi.fn(),
    loggerWarn: vi.fn(),
    mockSql: taggedSql,
  }
})

vi.mock('@sim/db/schema', () => ({
  document: {
    __table: 'document',
    connectorId: 'document.connectorId',
    deletedAt: 'document.deletedAt',
    fileSize: 'document.fileSize',
    knowledgeBaseId: 'document.knowledgeBaseId',
  },
  knowledgeBase: {
    __table: 'knowledgeBase',
    id: 'knowledgeBase.id',
    workspaceId: 'knowledgeBase.workspaceId',
  },
  organization: {
    __table: 'organization',
    id: 'organization.id',
    storageUsedBytes: 'organization.storageUsedBytes',
  },
  userStats: {
    __table: 'userStats',
    storageUsedBytes: 'userStats.storageUsedBytes',
    userId: 'userStats.userId',
  },
  workspace: {
    __table: 'workspace',
    billedAccountUserId: 'workspace.billedAccountUserId',
    id: 'workspace.id',
    organizationId: 'workspace.organizationId',
    storageUsedBytes: 'workspace.storageUsedBytes',
  },
  workspaceFiles: {
    __table: 'workspaceFiles',
    context: 'workspaceFiles.context',
    deletedAt: 'workspaceFiles.deletedAt',
    size: 'workspaceFiles.size',
    workspaceId: 'workspaceFiles.workspaceId',
  },
}))

vi.mock('@sim/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: loggerInfo,
    warn: loggerWarn,
  }),
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => conditions),
  asc: vi.fn((field: unknown) => ({ field, order: 'asc' })),
  eq: vi.fn((field: unknown, value: unknown) => ({ field, value })),
  inArray: vi.fn((field: unknown, values: unknown[]) => ({ field, values })),
  sql: mockSql,
}))

import {
  changeOrganizationWorkspaceBilledAccountsInTx,
  changeWorkspaceStoragePayerInTx,
  changeWorkspaceStoragePayersInTx,
} from '@/lib/billing/storage/payer-transfer'
import type { DbOrTx } from '@/lib/db/types'

interface FakeTable {
  __table: string
}

interface FakeCondition {
  value: string
}

interface FakeWorkspace {
  id: string
  billedAccountUserId: string
  organizationId: string | null
  storageUsedBytes: number
}

interface FakeTransferState {
  documentBytes?: number
  organizations?: Record<string, number>
  users?: Record<string, number>
  workspace: FakeWorkspace
  workspaceFileBytes?: number
}

function createFakeTx(state: FakeTransferState) {
  const organizations = new Map(Object.entries(state.organizations ?? {}))
  const users = new Map(Object.entries(state.users ?? {}))
  const locks: string[] = []
  const updates: Array<{ id: string; table: string; values: Record<string, unknown> }> = []
  const executedQueries: Array<{ strings: TemplateStringsArray; values: unknown[] }> = []

  const select = vi.fn(() => {
    let table = ''
    let condition: FakeCondition = { value: '' }
    const chain = {
      from(source: FakeTable) {
        table = source.__table
        return chain
      },
      where(nextCondition: FakeCondition) {
        condition = nextCondition
        return chain
      },
      for() {
        return chain
      },
      async limit() {
        locks.push(`${table}:${condition.value}`)
        if (table === 'workspace') {
          return condition.value === state.workspace.id ? [state.workspace] : []
        }
        if (table === 'organization') {
          const usage = organizations.get(condition.value)
          return usage === undefined ? [] : [{ storageUsedBytes: usage }]
        }
        if (table === 'userStats') {
          const usage = users.get(condition.value)
          return usage === undefined ? [] : [{ storageUsedBytes: usage }]
        }
        return []
      },
    }
    return chain
  })

  const update = vi.fn((source: FakeTable) => {
    let values: Record<string, unknown> = {}
    const chain = {
      set(nextValues: Record<string, unknown>) {
        values = nextValues
        return chain
      },
      async where(condition: FakeCondition) {
        updates.push({ id: condition.value, table: source.__table, values })
      },
    }
    return chain
  })

  const execute = vi.fn(async (query: { strings: TemplateStringsArray; values: unknown[] }) => {
    executedQueries.push(query)
    return [
      {
        document_bytes: state.documentBytes ?? 0,
        workspace_file_bytes: state.workspaceFileBytes ?? 0,
      },
    ]
  })

  return {
    executedQueries,
    locks,
    tx: { execute, select, update } as unknown as DbOrTx,
    updates,
  }
}

function updateFor(
  updates: Array<{ id: string; table: string; values: Record<string, unknown> }>,
  table: string
) {
  return updates.find((update) => update.table === table)
}

interface FakeBatchTransferState {
  exactBytes: Record<string, number>
  organizations?: Record<string, number>
  users?: Record<string, number>
  workspaces: FakeWorkspace[]
}

interface FakeBatchCondition {
  values: string[]
}

interface FakeSqlExpression {
  values: unknown[]
}

function createFakeBatchTx(state: FakeBatchTransferState) {
  const organizations = new Map(Object.entries(state.organizations ?? {}))
  const users = new Map(Object.entries(state.users ?? {}))
  const workspaceById = new Map(state.workspaces.map((row) => [row.id, row]))
  const locks: Array<{ ids: string[]; table: string }> = []
  const updates: Array<{
    ids: string[]
    table: string
    values: Record<string, unknown>
  }> = []
  const execute = vi.fn(async () =>
    Object.entries(state.exactBytes).map(([workspaceId, bytes]) => ({
      workspace_id: workspaceId,
      document_bytes: 0,
      workspace_file_bytes: bytes,
    }))
  )

  const select = vi.fn(() => {
    let table = ''
    let condition: FakeBatchCondition = { values: [] }
    let lockRecorded = false
    const rows = () => {
      const ids = [...condition.values].sort()
      if (table === 'workspace') {
        return ids.flatMap((id) => {
          const row = workspaceById.get(id)
          return row ? [row] : []
        })
      }
      if (table === 'organization') {
        return ids.flatMap((id) => {
          const storageUsedBytes = organizations.get(id)
          return storageUsedBytes === undefined ? [] : [{ id, storageUsedBytes }]
        })
      }
      if (table === 'userStats') {
        return ids.flatMap((id) => {
          const storageUsedBytes = users.get(id)
          return storageUsedBytes === undefined ? [] : [{ id, storageUsedBytes }]
        })
      }
      return []
    }
    const chain = {
      from(source: FakeTable) {
        table = source.__table
        return chain
      },
      where(nextCondition: FakeBatchCondition) {
        condition = nextCondition
        return chain
      },
      orderBy() {
        return chain
      },
      for() {
        if (!lockRecorded) {
          locks.push({ ids: [...condition.values], table })
          lockRecorded = true
        }
        return chain
      },
      then(resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) {
        return Promise.resolve(rows()).then(resolve, reject)
      },
    }
    return chain
  })

  const update = vi.fn((source: FakeTable) => ({
    set: (values: Record<string, unknown>) => ({
      where: async (condition: FakeBatchCondition) => {
        updates.push({ ids: [...condition.values], table: source.__table, values })
      },
    }),
  }))

  return {
    execute,
    locks,
    tx: { execute, select, update } as unknown as DbOrTx,
    updates,
  }
}

function readCaseAssignments(expression: unknown): Record<string, number> {
  const outer = expression as FakeSqlExpression
  const joined = outer.values[1] as { chunks: FakeSqlExpression[] }
  return Object.fromEntries(
    joined.chunks.map((chunk) => [String(chunk.values[0]), Number(chunk.values[1])])
  )
}

describe('changeWorkspaceStoragePayerInTx', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('moves exact personal workspace bytes to an organization without a quota check', async () => {
    const fake = createFakeTx({
      workspace: {
        id: 'workspace-1',
        billedAccountUserId: 'user-source',
        organizationId: null,
        storageUsedBytes: 150,
      },
      workspaceFileBytes: 100,
      documentBytes: 50,
      users: { 'user-source': 900 },
      organizations: { 'org-destination': 400 },
    })

    const result = await changeWorkspaceStoragePayerInTx(fake.tx, {
      workspaceId: 'workspace-1',
      organizationId: 'org-destination',
      billedAccountUserId: 'org-owner',
    })

    expect(result.billableBytes).toBe(150)
    expect(updateFor(fake.updates, 'userStats')?.values).toEqual({ storageUsedBytes: 750 })
    expect(updateFor(fake.updates, 'organization')?.values).toEqual({ storageUsedBytes: 550 })
    expect(updateFor(fake.updates, 'workspace')?.values).toEqual({
      billedAccountUserId: 'org-owner',
      organizationId: 'org-destination',
      storageUsedBytes: 150,
    })
  })

  it('moves organization workspace bytes to a personal payer', async () => {
    const fake = createFakeTx({
      workspace: {
        id: 'workspace-1',
        billedAccountUserId: 'old-org-owner',
        organizationId: 'org-source',
        storageUsedBytes: 80,
      },
      workspaceFileBytes: 80,
      organizations: { 'org-source': 300 },
      users: { 'user-destination': 20 },
    })

    await changeWorkspaceStoragePayerInTx(fake.tx, {
      workspaceId: 'workspace-1',
      organizationId: null,
      billedAccountUserId: 'user-destination',
    })

    expect(updateFor(fake.updates, 'organization')?.values).toEqual({ storageUsedBytes: 220 })
    expect(updateFor(fake.updates, 'userStats')?.values).toEqual({ storageUsedBytes: 100 })
  })

  it('moves organization workspace bytes between organizations', async () => {
    const fake = createFakeTx({
      workspace: {
        id: 'workspace-1',
        billedAccountUserId: 'owner-a',
        organizationId: 'org-a',
        storageUsedBytes: 60,
      },
      documentBytes: 60,
      organizations: { 'org-a': 160, 'org-b': 40 },
    })

    await changeWorkspaceStoragePayerInTx(fake.tx, {
      workspaceId: 'workspace-1',
      organizationId: 'org-b',
      billedAccountUserId: 'owner-b',
    })

    expect(fake.updates.filter(({ table }) => table === 'organization')).toEqual([
      { id: 'org-a', table: 'organization', values: { storageUsedBytes: 100 } },
      { id: 'org-b', table: 'organization', values: { storageUsedBytes: 100 } },
    ])
  })

  it('updates same-payer metadata without aggregate queries, payer locks, or ledger repair', async () => {
    const fake = createFakeTx({
      workspace: {
        id: 'workspace-1',
        billedAccountUserId: 'old-owner',
        organizationId: 'org-a',
        storageUsedBytes: 999,
      },
      workspaceFileBytes: 40,
      documentBytes: 10,
      organizations: { 'org-a': 500 },
    })

    const result = await changeWorkspaceStoragePayerInTx(fake.tx, {
      workspaceId: 'workspace-1',
      organizationId: 'org-a',
      billedAccountUserId: 'new-owner',
    })

    expect(result).toMatchObject({
      billableBytes: 999,
      repairedWorkspaceLedger: false,
    })
    expect(fake.executedQueries).toEqual([])
    expect(fake.locks).toEqual(['workspace:workspace-1'])
    expect(fake.updates).toEqual([
      {
        id: 'workspace-1',
        table: 'workspace',
        values: {
          billedAccountUserId: 'new-owner',
          organizationId: 'org-a',
        },
      },
    ])
    expect(loggerWarn).not.toHaveBeenCalled()
  })

  it('conservatively clamps an underfunded source aggregate and logs the drift repair', async () => {
    const fake = createFakeTx({
      workspace: {
        id: 'workspace-1',
        billedAccountUserId: 'user-source',
        organizationId: null,
        storageUsedBytes: 5,
      },
      workspaceFileBytes: 120,
      users: { 'user-source': 20, 'user-destination': 30 },
    })

    await changeWorkspaceStoragePayerInTx(fake.tx, {
      workspaceId: 'workspace-1',
      organizationId: null,
      billedAccountUserId: 'user-destination',
    })

    expect(fake.updates.filter(({ table }) => table === 'userStats')).toEqual([
      { id: 'user-source', table: 'userStats', values: { storageUsedBytes: 0 } },
      { id: 'user-destination', table: 'userStats', values: { storageUsedBytes: 150 } },
    ])
    expect(loggerWarn).toHaveBeenCalledWith(
      'Clamping drifted source storage aggregate during workspace payer change',
      expect.objectContaining({ sourceUsage: 20, transferredBytes: 120 })
    )
  })

  it('continues from a missing historical source but never hides a missing destination', async () => {
    const missingSource = createFakeTx({
      workspace: {
        id: 'workspace-1',
        billedAccountUserId: 'missing-source',
        organizationId: null,
        storageUsedBytes: 25,
      },
      workspaceFileBytes: 25,
      organizations: { 'org-destination': 10 },
    })

    await expect(
      changeWorkspaceStoragePayerInTx(missingSource.tx, {
        workspaceId: 'workspace-1',
        organizationId: 'org-destination',
        billedAccountUserId: 'org-owner',
      })
    ).resolves.toMatchObject({ billableBytes: 25 })
    expect(updateFor(missingSource.updates, 'organization')?.values).toEqual({
      storageUsedBytes: 35,
    })

    const missingDestination = createFakeTx({
      workspace: {
        id: 'workspace-1',
        billedAccountUserId: 'user-source',
        organizationId: null,
        storageUsedBytes: 25,
      },
      workspaceFileBytes: 25,
      users: { 'user-source': 50 },
    })

    await expect(
      changeWorkspaceStoragePayerInTx(missingDestination.tx, {
        workspaceId: 'workspace-1',
        organizationId: 'missing-org',
        billedAccountUserId: 'org-owner',
      })
    ).rejects.toThrow('Storage destination payer organization:missing-org not found')
    expect(missingDestination.updates).toEqual([])
  })

  it('locks the workspace first, then user payers before organization payers', async () => {
    const fake = createFakeTx({
      workspace: {
        id: 'workspace-1',
        billedAccountUserId: 'user-z',
        organizationId: null,
        storageUsedBytes: 1,
      },
      workspaceFileBytes: 1,
      organizations: { 'org-a': 0 },
      users: { 'user-z': 1 },
    })

    await changeWorkspaceStoragePayerInTx(fake.tx, {
      workspaceId: 'workspace-1',
      organizationId: 'org-a',
      billedAccountUserId: 'org-owner',
    })

    expect(fake.locks).toEqual(['workspace:workspace-1', 'userStats:user-z', 'organization:org-a'])
  })

  it('uses bounded live aggregates with archived workspace files included', async () => {
    const fake = createFakeTx({
      workspace: {
        id: 'workspace-1',
        billedAccountUserId: 'user-1',
        organizationId: null,
        storageUsedBytes: 0,
      },
      users: { 'user-1': 0, 'user-2': 0 },
    })

    await changeWorkspaceStoragePayerInTx(fake.tx, {
      workspaceId: 'workspace-1',
      organizationId: null,
      billedAccountUserId: 'user-2',
    })

    expect(fake.executedQueries).toHaveLength(1)
    const query = fake.executedQueries[0]
    expect(query.strings.join(' ')).toContain("= 'workspace'")
    expect(query.values).toContain('workspaceFiles.workspaceId')
    expect(query.values).not.toContain('workspaceFiles.deletedAt')
    expect(query.values).toContain('document.connectorId')
    expect(query.values).toContain('document.deletedAt')
    expect(query.values.filter((value) => value === 'workspace-1')).toHaveLength(2)
  })
})

describe('changeWorkspaceStoragePayersInTx', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses the same payer lock order for opposite-direction moves', async () => {
    const personalToOrganization = createFakeBatchTx({
      exactBytes: { 'workspace-a': 10 },
      organizations: { 'org-a': 0 },
      users: { 'user-z': 10 },
      workspaces: [
        {
          id: 'workspace-a',
          billedAccountUserId: 'user-z',
          organizationId: null,
          storageUsedBytes: 10,
        },
      ],
    })
    const organizationToPersonal = createFakeBatchTx({
      exactBytes: { 'workspace-b': 10 },
      organizations: { 'org-a': 10 },
      users: { 'user-z': 0 },
      workspaces: [
        {
          id: 'workspace-b',
          billedAccountUserId: 'org-owner',
          organizationId: 'org-a',
          storageUsedBytes: 10,
        },
      ],
    })

    await changeWorkspaceStoragePayersInTx(personalToOrganization.tx, [
      {
        workspaceId: 'workspace-a',
        organizationId: 'org-a',
        billedAccountUserId: 'org-owner',
      },
    ])
    await changeWorkspaceStoragePayersInTx(organizationToPersonal.tx, [
      {
        workspaceId: 'workspace-b',
        organizationId: null,
        billedAccountUserId: 'user-z',
      },
    ])

    expect(personalToOrganization.locks.map(({ table }) => table)).toEqual([
      'workspace',
      'userStats',
      'organization',
    ])
    expect(organizationToPersonal.locks.map(({ table }) => table)).toEqual([
      'workspace',
      'userStats',
      'organization',
    ])
    expect(personalToOrganization.updates.map(({ table }) => table)).toEqual([
      'userStats',
      'organization',
      'workspace',
    ])
    expect(organizationToPersonal.updates.map(({ table }) => table)).toEqual([
      'userStats',
      'organization',
      'workspace',
    ])
  })

  it('aggregates payer deltas once and clamps outgoing bytes before adding incoming bytes', async () => {
    const fake = createFakeBatchTx({
      exactBytes: { 'workspace-a': 40, 'workspace-b': 40 },
      users: { destination: 10, source: 50 },
      workspaces: [
        {
          id: 'workspace-b',
          billedAccountUserId: 'source',
          organizationId: null,
          storageUsedBytes: 40,
        },
        {
          id: 'workspace-a',
          billedAccountUserId: 'source',
          organizationId: null,
          storageUsedBytes: 40,
        },
      ],
    })

    await changeWorkspaceStoragePayersInTx(fake.tx, [
      {
        workspaceId: 'workspace-b',
        organizationId: null,
        billedAccountUserId: 'destination',
      },
      {
        workspaceId: 'workspace-a',
        organizationId: null,
        billedAccountUserId: 'destination',
      },
    ])

    expect(fake.execute).toHaveBeenCalledTimes(1)
    expect(fake.locks).toEqual([
      { ids: ['workspace-a', 'workspace-b'], table: 'workspace' },
      { ids: ['destination', 'source'], table: 'userStats' },
    ])
    const userStatsUpdates = fake.updates.filter(({ table }) => table === 'userStats')
    expect(userStatsUpdates).toHaveLength(1)
    expect(readCaseAssignments(userStatsUpdates[0]?.values.storageUsedBytes)).toEqual({
      destination: 90,
      source: 0,
    })
    expect(fake.updates.filter(({ table }) => table === 'workspace')).toHaveLength(1)
  })

  it('rejects a stale expected payer before aggregate work or writes', async () => {
    const fake = createFakeBatchTx({
      exactBytes: { 'workspace-a': 10 },
      users: { current: 10, destination: 0 },
      workspaces: [
        {
          id: 'workspace-a',
          billedAccountUserId: 'current',
          organizationId: null,
          storageUsedBytes: 10,
        },
      ],
    })

    await expect(
      changeWorkspaceStoragePayersInTx(fake.tx, [
        {
          workspaceId: 'workspace-a',
          organizationId: null,
          billedAccountUserId: 'destination',
          expectedCurrentPayer: {
            organizationId: null,
            billedAccountUserId: 'stale',
          },
        },
      ])
    ).rejects.toThrow('Workspace workspace-a payer changed before the transaction lock')

    expect(fake.execute).not.toHaveBeenCalled()
    expect(fake.updates).toEqual([])
    expect(fake.locks).toEqual([{ ids: ['workspace-a'], table: 'workspace' }])
  })
})

describe('changeOrganizationWorkspaceBilledAccountsInTx', () => {
  it('locks matching workspaces in ID order before the conditional update', async () => {
    const returning = vi.fn().mockResolvedValue([{ id: 'workspace-a' }, { id: 'workspace-b' }])
    const where = vi.fn().mockReturnValue({ returning })
    const set = vi.fn().mockReturnValue({ where })
    const update = vi.fn().mockReturnValue({ set })
    const lock = vi.fn().mockResolvedValue([{ id: 'workspace-a' }, { id: 'workspace-b' }])
    const orderBy = vi.fn().mockReturnValue({ for: lock })
    const selectWhere = vi.fn().mockReturnValue({ orderBy })
    const from = vi.fn().mockReturnValue({ where: selectWhere })
    const select = vi.fn().mockReturnValue({ from })
    const execute = vi.fn()
    const tx = { execute, select, update } as unknown as DbOrTx

    const workspaceIds = await changeOrganizationWorkspaceBilledAccountsInTx(tx, {
      organizationId: 'org-a',
      expectedCurrentBilledAccountUserId: 'owner-a',
      billedAccountUserId: 'owner-b',
    })

    expect(workspaceIds).toEqual(['workspace-a', 'workspace-b'])
    expect(update).toHaveBeenCalledTimes(1)
    expect(set).toHaveBeenCalledWith({ billedAccountUserId: 'owner-b' })
    expect(where).toHaveBeenCalledTimes(1)
    expect(returning).toHaveBeenCalledWith({ id: 'workspace.id' })
    expect(select).toHaveBeenCalledWith({ id: 'workspace.id' })
    expect(orderBy).toHaveBeenCalledTimes(1)
    expect(lock).toHaveBeenCalledWith('update')
    expect(lock.mock.invocationCallOrder[0]).toBeLessThan(update.mock.invocationCallOrder[0])
    expect(execute).not.toHaveBeenCalled()
  })
})

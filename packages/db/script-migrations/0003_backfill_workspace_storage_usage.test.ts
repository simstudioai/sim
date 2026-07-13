import type { Sql } from 'postgres'
import { describe, expect, it } from 'vitest'
import {
  createPostgresStorageReconciliationStore,
  reconcileWorkspaceStorageAccounting,
} from './0003_backfill_workspace_storage_usage'

interface FakeWorkspace {
  id: string
  payerType: 'organization' | 'user'
  payerId: string
  sourceBytes: number
  storageUsedBytes: number
}

class FakeStorageReconciliationStore {
  readonly workspaces: FakeWorkspace[]
  readonly organizationIds: string[]
  readonly userIds: string[]
  readonly payerTotals = new Map<string, number>()
  readonly payerCalls: string[] = []
  readonly workspacePages: string[][] = []

  constructor({
    workspaces,
    organizationIds,
    userIds,
  }: {
    workspaces: FakeWorkspace[]
    organizationIds: string[]
    userIds: string[]
  }) {
    this.workspaces = workspaces
    this.organizationIds = organizationIds
    this.userIds = userIds
  }

  async listWorkspaceIds(afterId: string, limit: number) {
    return this.workspaces
      .map(({ id }) => id)
      .filter((id) => id > afterId)
      .sort()
      .slice(0, limit)
  }

  async reconcileWorkspaces(workspaceIds: string[]) {
    this.workspacePages.push(workspaceIds)
    for (const workspace of this.workspaces.filter(({ id }) => workspaceIds.includes(id))) {
      workspace.storageUsedBytes = workspace.sourceBytes
    }
  }

  async listOrganizationIds(afterId: string, limit: number) {
    return this.organizationIds
      .filter((id) => id > afterId)
      .sort()
      .slice(0, limit)
  }

  async reconcileOrganization(organizationId: string) {
    this.payerCalls.push(`organization:${organizationId}`)
    const total = this.workspaces
      .filter(
        (workspace) =>
          workspace.payerType === 'organization' && workspace.payerId === organizationId
      )
      .reduce((sum, workspace) => sum + workspace.storageUsedBytes, 0)
    this.payerTotals.set(`organization:${organizationId}`, total)
  }

  async listUserIds(afterId: string, limit: number) {
    return this.userIds
      .filter((id) => id > afterId)
      .sort()
      .slice(0, limit)
  }

  async reconcileUser(userId: string) {
    this.payerCalls.push(`user:${userId}`)
    const total = this.workspaces
      .filter((workspace) => workspace.payerType === 'user' && workspace.payerId === userId)
      .reduce((sum, workspace) => sum + workspace.storageUsedBytes, 0)
    this.payerTotals.set(`user:${userId}`, total)
  }
}

describe('workspace storage reconciliation', () => {
  it('rebuilds workspace and payer totals in bounded keyset pages', async () => {
    const store = new FakeStorageReconciliationStore({
      workspaces: [
        {
          id: 'workspace-a',
          payerType: 'user',
          payerId: 'user-a',
          sourceBytes: 12,
          storageUsedBytes: 999,
        },
        {
          id: 'workspace-b',
          payerType: 'organization',
          payerId: 'org-a',
          sourceBytes: 20,
          storageUsedBytes: 0,
        },
        {
          id: 'workspace-c',
          payerType: 'organization',
          payerId: 'org-a',
          sourceBytes: 30,
          storageUsedBytes: 1,
        },
      ],
      organizationIds: ['org-a', 'org-empty'],
      userIds: ['user-a', 'user-empty'],
    })

    const result = await reconcileWorkspaceStorageAccounting(store, { batchSize: 2 })

    expect(result).toEqual({ workspaces: 3, organizations: 2, users: 2 })
    expect(store.workspacePages).toEqual([['workspace-a', 'workspace-b'], ['workspace-c']])
    expect(store.workspaces.map(({ storageUsedBytes }) => storageUsedBytes)).toEqual([12, 20, 30])
    expect(store.payerTotals).toEqual(
      new Map([
        ['organization:org-a', 50],
        ['organization:org-empty', 0],
        ['user:user-a', 12],
        ['user:user-empty', 0],
      ])
    )
    expect(store.payerCalls).toEqual([
      'organization:org-a',
      'organization:org-empty',
      'user:user-a',
      'user:user-empty',
    ])
  })

  it('is idempotent and uses each payer live workspace total', async () => {
    const store = new FakeStorageReconciliationStore({
      workspaces: [
        {
          id: 'workspace-a',
          payerType: 'user',
          payerId: 'user-a',
          sourceBytes: 42,
          storageUsedBytes: 0,
        },
      ],
      organizationIds: [],
      userIds: ['user-a'],
    })

    await reconcileWorkspaceStorageAccounting(store)
    store.payerTotals.set('user:user-a', 999)
    await reconcileWorkspaceStorageAccounting(store)

    expect(store.workspaces[0].storageUsedBytes).toBe(42)
    expect(store.payerTotals.get('user:user-a')).toBe(42)
  })

  it('backfills only workspace shadow ledgers during the expand phase', async () => {
    const store = new FakeStorageReconciliationStore({
      workspaces: [
        {
          id: 'workspace-a',
          payerType: 'user',
          payerId: 'user-a',
          sourceBytes: 7,
          storageUsedBytes: 0,
        },
      ],
      organizationIds: [],
      userIds: ['user-a'],
    })
    store.payerTotals.set('user:user-a', 123)

    const result = await reconcileWorkspaceStorageAccounting(store, {
      reconcilePayers: false,
    })

    expect(store.workspaces[0].storageUsedBytes).toBe(7)
    expect(store.payerTotals.get('user:user-a')).toBe(123)
    expect(store.payerCalls).toEqual([])
    expect(result).toEqual({ workspaces: 1, organizations: 0, users: 0 })
  })

  it('locks and reconciles one live payer at a time without a temporary snapshot', async () => {
    const queries: string[] = []
    const query = async (strings: TemplateStringsArray) => {
      const text = strings.join(' ')
      queries.push(text)
      if (text.includes('SELECT id') && text.includes('FROM organization')) {
        return [{ id: 'org-a' }]
      }
      if (text.includes('SELECT user_id AS id') && text.includes('FROM user_stats')) {
        return [{ id: 'user-a' }]
      }
      if (text.includes('coalesce(sum(storage_used_bytes)')) {
        return [{ storage_used_bytes: 42 }]
      }
      return []
    }
    const sql = Object.assign(query, {
      begin: async (callback: (tx: typeof query) => Promise<void>) => callback(query),
    }) as unknown as Sql
    const store = createPostgresStorageReconciliationStore(sql)

    await store.reconcileOrganization('org-a')
    await store.reconcileUser('user-a')

    expect(queries.some((text) => text.includes('CREATE TEMPORARY TABLE'))).toBe(false)
    expect(queries.some((text) => text.includes('pg_advisory'))).toBe(false)
    const organizationLock = queries.findIndex(
      (text) => text.includes('FROM organization') && text.includes('FOR UPDATE')
    )
    const organizationSum = queries.findIndex(
      (text) => text.includes('FROM workspace') && text.includes('organization_id =')
    )
    const organizationUpdate = queries.findIndex((text) => text.includes('UPDATE organization'))
    expect(organizationLock).toBeGreaterThanOrEqual(0)
    expect(organizationSum).toBeGreaterThan(organizationLock)
    expect(organizationUpdate).toBeGreaterThan(organizationSum)
    expect(
      queries.some(
        (text) =>
          text.includes('FROM workspace') &&
          text.includes('organization_id IS NULL') &&
          text.includes('billed_account_user_id =')
      )
    ).toBe(true)
  })

  it('counts archived workspace files while excluding mothership and connector rows', async () => {
    const queries: string[] = []
    const query = async (strings: TemplateStringsArray) => {
      const text = strings.join(' ')
      queries.push(text)
      return text.includes('count(*) AS invalid_count') ? [{ invalid_count: 0 }] : []
    }
    const sql = Object.assign(query, {
      begin: async (callback: (tx: typeof query) => Promise<void>) => callback(query),
    }) as unknown as Sql
    const store = createPostgresStorageReconciliationStore(sql)

    await store.reconcileWorkspaces(['workspace-a'])

    const workspaceFileQueries = queries.filter((text) => text.includes('FROM workspace_files'))
    const workspaceFileClauses = workspaceFileQueries.flatMap(
      (text) => text.match(/FROM workspace_files[\s\S]*?(?=UNION ALL|GROUP BY)/g) ?? []
    )
    expect(workspaceFileQueries).toHaveLength(2)
    expect(workspaceFileClauses).toHaveLength(2)
    expect(workspaceFileQueries.every((text) => text.includes("context = 'workspace'"))).toBe(true)
    expect(workspaceFileClauses.every((text) => !text.includes('deleted_at IS NULL'))).toBe(true)
    expect(queries.some((text) => text.includes('d.connector_id IS NULL'))).toBe(true)
    expect(queries.some((text) => text.includes('d.deleted_at IS NULL'))).toBe(true)
  })
})

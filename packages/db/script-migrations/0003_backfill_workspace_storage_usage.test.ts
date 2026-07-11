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
  readonly legacyDocumentIds: string[]
  readonly payerTotals = new Map<string, number>()
  readonly tempTotals = new Map<string, number>()
  hasUnattributedWorkspaceFile = false
  finished = false

  constructor({
    workspaces,
    organizationIds,
    userIds,
    legacyDocumentIds = [],
  }: {
    workspaces: FakeWorkspace[]
    organizationIds: string[]
    userIds: string[]
    legacyDocumentIds?: string[]
  }) {
    this.workspaces = workspaces
    this.organizationIds = organizationIds
    this.userIds = userIds
    this.legacyDocumentIds = legacyDocumentIds
  }

  async prepare() {
    this.tempTotals.clear()
    this.finished = false
  }

  async assertNoUnattributedWorkspaceFiles() {
    if (this.hasUnattributedWorkspaceFile) {
      throw new Error('Cannot reconcile payer storage exactly: workspace file is unattributed')
    }
  }

  async listWorkspaceIds(afterId: string, limit: number) {
    return this.workspaces
      .map(({ id }) => id)
      .filter((id) => id > afterId)
      .sort()
      .slice(0, limit)
  }

  async reconcileWorkspaces(workspaceIds: string[]) {
    for (const workspace of this.workspaces.filter(({ id }) => workspaceIds.includes(id))) {
      workspace.storageUsedBytes = workspace.sourceBytes
      const key = `${workspace.payerType}:${workspace.payerId}`
      this.tempTotals.set(key, (this.tempTotals.get(key) ?? 0) + workspace.sourceBytes)
    }
  }

  async listLegacyDocumentIds(afterId: string, limit: number) {
    return this.legacyDocumentIds
      .filter((id) => id > afterId)
      .sort()
      .slice(0, limit)
  }

  async accumulateLegacyDocuments(documentIds: string[]) {
    throw new Error(
      `Cannot reconcile payer storage exactly: legacy document ${documentIds[0]} has no workspace payer history`
    )
  }

  async listOrganizationIds(afterId: string, limit: number) {
    return this.organizationIds
      .filter((id) => id > afterId)
      .sort()
      .slice(0, limit)
  }

  async reconcileOrganizations(organizationIds: string[]) {
    for (const id of organizationIds) {
      this.payerTotals.set(`organization:${id}`, this.tempTotals.get(`organization:${id}`) ?? 0)
    }
  }

  async listUserIds(afterId: string, limit: number) {
    return this.userIds
      .filter((id) => id > afterId)
      .sort()
      .slice(0, limit)
  }

  async reconcileUsers(userIds: string[]) {
    for (const id of userIds) {
      this.payerTotals.set(`user:${id}`, this.tempTotals.get(`user:${id}`) ?? 0)
    }
  }

  async finish() {
    this.finished = true
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

    expect(result).toEqual({
      workspaces: 3,
      legacyDocuments: 0,
      organizations: 2,
      users: 2,
    })
    expect(store.workspaces.map(({ storageUsedBytes }) => storageUsedBytes)).toEqual([12, 20, 30])
    expect(store.payerTotals).toEqual(
      new Map([
        ['organization:org-a', 50],
        ['organization:org-empty', 0],
        ['user:user-a', 12],
        ['user:user-empty', 0],
      ])
    )
    expect(store.finished).toBe(true)
  })

  it('is idempotent when the full reconciliation is rerun', async () => {
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
    await reconcileWorkspaceStorageAccounting(store)

    expect(store.workspaces[0].storageUsedBytes).toBe(42)
    expect(store.payerTotals.get('user:user-a')).toBe(42)
  })

  it('backfills only workspace ledgers during the expand phase', async () => {
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
    expect(result).toEqual({
      workspaces: 1,
      legacyDocuments: 0,
      organizations: 0,
      users: 0,
    })
  })

  it('fails explicitly when legacy metadata has no exact payer attribution', async () => {
    const store = new FakeStorageReconciliationStore({
      workspaces: [],
      organizationIds: [],
      userIds: [],
      legacyDocumentIds: ['document-a'],
    })

    await expect(reconcileWorkspaceStorageAccounting(store)).rejects.toThrow(
      'legacy document document-a has no workspace payer history'
    )
    expect(store.finished).toBe(true)
  })

  it('counts workspace files once and excludes all mothership rows from SQL sources', async () => {
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

    await store.assertNoUnattributedWorkspaceFiles()
    await store.reconcileWorkspaces(['workspace-a'])

    const sourceQueries = queries.filter((text) => text.includes('FROM workspace_files'))
    expect(sourceQueries).toHaveLength(3)
    expect(sourceQueries.every((text) => text.includes("context = 'workspace'"))).toBe(true)
    expect(sourceQueries.every((text) => !text.includes('mothership'))).toBe(true)
    expect(queries.some((text) => text.includes('document_totals'))).toBe(true)
  })
})

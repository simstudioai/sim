/**
 * @vitest-environment node
 */
import { flattenMockConditions, hasMockCondition } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The global `@sim/db` mock carries the chain fns but no table objects, and
 * this module reaches for `workflowMcpTool` directly.
 */
vi.mock('@sim/db', async () => {
  const { databaseMock } = await import('@sim/testing')
  const column = (name: string) => `workflow_mcp_tool.${name}`
  return {
    ...databaseMock,
    workflowMcpServer: { id: 'workflow_mcp_server.id', workspaceId: 'workflow_mcp_server.ws' },
    workflowMcpTool: {
      id: column('id'),
      serverId: column('server_id'),
      workflowId: column('workflow_id'),
      toolName: column('tool_name'),
      toolDescription: column('tool_description'),
      parameterSchema: column('parameter_schema'),
      parameterDescriptionOverrides: column('parameter_description_overrides'),
      archivedAt: column('archived_at'),
      createdAt: column('created_at'),
      updatedAt: column('updated_at'),
    },
  }
})

const { mocks } = vi.hoisted(() => ({
  mocks: {
    acquireLock: vi.fn(),
    hasValidStartBlock: vi.fn(),
    loadDeployedState: vi.fn(),
    usageRows: vi.fn(),
    exceedsBudget: vi.fn(),
  },
}))

vi.mock('@/lib/mcp/server-locks', () => ({
  acquireWorkflowMcpServerLock: mocks.acquireLock,
}))
vi.mock('@/lib/workflows/triggers/trigger-utils', () => ({
  hasValidStartBlockInState: mocks.hasValidStartBlock,
}))
vi.mock('@/lib/workflows/persistence/utils', () => ({
  loadDeployedWorkflowState: mocks.loadDeployedState,
}))
vi.mock('@/lib/mcp/pubsub', () => ({ mcpPubSub: null }))
vi.mock('@/lib/mcp/workflow-tool-schema', () => ({
  applyDescriptionOverrides: (schema: unknown) => schema,
  extractInputFormatFromBlocks: () => [],
  generateToolInputSchema: () => ({ type: 'object', properties: {} }),
  pruneOverridesToSchema: (overrides: unknown) => overrides,
}))
vi.mock('@/lib/mcp/tool-limits', () => ({
  addMcpToolMetadataUsageRow: () => ({ bytes: 0 }),
  createMcpToolMetadataUsageRow: (row: unknown) => row,
  exceedsMcpServerToolMetadataBudget: mocks.exceedsBudget,
  getMcpServerToolMetadataUsageRows: mocks.usageRows,
  getMcpToolMetadataUsageFromRows: () => ({ bytes: 0 }),
  subtractMcpToolMetadataUsageRow: () => ({ bytes: 0 }),
  validateMcpToolMetadataForStorage: () => null,
}))

import { workflowMcpTool } from '@sim/db'
import { MAX_MCP_SERVERS_PER_WORKFLOW, MAX_MCP_TOOLS_PER_SERVER } from '@/lib/mcp/constants'
import { removeMcpToolsForWorkflow, syncMcpToolsForWorkflow } from '@/lib/mcp/workflow-mcp-sync'

const WORKFLOW_ID = 'wf-1'
const REQUEST_ID = 'req-1'

interface RecordedWrite {
  op: 'update' | 'delete'
  table: unknown
  values?: Record<string, unknown>
  where?: unknown
}

/**
 * A queued read is either a fixed row set or a thunk evaluated at read time, so
 * a test can model a row another transaction commits partway through the sync.
 */
type QueuedRead = unknown[] | (() => unknown[])

/** Marks the handle `.as(alias)` returns so `.from()` can recognise a subquery. */
const FAKE_SUBQUERY = Symbol('fakeSubquery')

interface FakeSelect {
  projection: Record<string, unknown>
  distinctOn: unknown[]
  order: { type: string; column: unknown }[]
  limit: number | null
  source: FakeSelect | null
  where: unknown
}

interface FakeOrderNode {
  type: string
  column: unknown
}

/**
 * Minimal drizzle chain over an ordered queue of results, so the sync's exact
 * statement sequence — and whether a withdrawal deletes or archives — is
 * observable without a live database.
 *
 * `orderBy`, `selectDistinctOn` and `limit` are evaluated the way Postgres
 * evaluates them (sort, then dedupe on the leading key, then bound), and a
 * select whose `from` is another select's `.as(alias)` evaluates that inner
 * statement first. A test can therefore observe which rows a bounded, possibly
 * two-stage candidate query actually returns rather than being handed a canned
 * answer.
 *
 * `liveServerIds` models the one correlated anti-join the restore issues: a
 * select whose WHERE carries a `notExists` drops the rows whose `serverId` the
 * workflow already holds a live registration on, exactly as the subquery would.
 * A statement that does not ask for the anti-join is filtered by nothing, so a
 * fixture can tell the two apart.
 */
function createFakeTx(results: QueuedRead[], liveServerIds: string[] = []) {
  const writes: RecordedWrite[] = []
  const queue = [...results]
  const liveServers = new Set(liveServerIds)
  let pending: RecordedWrite | null = null
  const selects: FakeSelect[] = []

  const top = (): FakeSelect | null => selects.at(-1) ?? null

  const startSelect = (projection: Record<string, unknown>, distinctOn: unknown[]): void => {
    selects.push({ projection, distinctOn, order: [], limit: null, source: null, where: undefined })
  }

  /** Resolves an order/distinct column token to the row key it was selected as. */
  const rowKeyFor = (select: FakeSelect, column: unknown): string | null => {
    const projection = select.source ? select.source.projection : select.projection
    return Object.keys(projection).find((key) => projection[key] === column) ?? null
  }

  const compare = (a: unknown, b: unknown): number => {
    if ((a as never) < (b as never)) return -1
    if ((a as never) > (b as never)) return 1
    return 0
  }

  const evaluate = (select: FakeSelect): unknown[] => {
    let rows: unknown[]
    if (select.source) {
      rows = evaluate(select.source)
    } else {
      const next = queue.shift() ?? []
      rows = typeof next === 'function' ? next() : next
    }

    if (hasMockCondition(select.where, (node) => node.type === 'notExists')) {
      rows = rows.filter(
        (row) => !liveServers.has((row as { serverId?: string }).serverId as string)
      )
    }

    if (select.order.length > 0) {
      rows = [...rows].sort((left, right) => {
        for (const node of select.order) {
          const key = rowKeyFor(select, node.column)
          if (!key) continue
          const result = compare(
            (left as Record<string, unknown>)[key],
            (right as Record<string, unknown>)[key]
          )
          if (result !== 0) return node.type === 'desc' ? -result : result
        }
        return 0
      })
    }

    if (select.distinctOn.length > 0) {
      const keys = select.distinctOn
        .map((column) => rowKeyFor(select, column))
        .filter((key): key is string => key !== null)
      const seen = new Set<string>()
      rows = rows.filter((row) => {
        const identity = JSON.stringify(keys.map((key) => (row as Record<string, unknown>)[key]))
        if (seen.has(identity)) return false
        seen.add(identity)
        return true
      })
    }

    return select.limit === null ? rows : rows.slice(0, select.limit)
  }

  const builder: Record<string, unknown> = {
    select(projection: Record<string, unknown>) {
      startSelect(projection ?? {}, [])
      return builder
    },
    selectDistinctOn(columns: unknown[], projection: Record<string, unknown>) {
      startSelect(projection ?? {}, columns)
      return builder
    },
    from(source: unknown) {
      const handle = (source as Record<symbol, FakeSelect> | null)?.[FAKE_SUBQUERY]
      const select = top()
      if (select && handle) select.source = handle
      return builder
    },
    orderBy(...nodes: FakeOrderNode[]) {
      const select = top()
      if (select) select.order = nodes
      return builder
    },
    limit(value: number) {
      const select = top()
      if (select) select.limit = value
      return builder
    },
    as() {
      const select = selects.pop() ?? null
      return new Proxy(
        {},
        {
          get(_target, key) {
            if (key === FAKE_SUBQUERY) return select
            return select?.projection[key as string]
          },
        }
      )
    },
    update(table: unknown) {
      pending = { op: 'update', table }
      return builder
    },
    delete(table: unknown) {
      pending = { op: 'delete', table }
      writes.push(pending)
      return builder
    },
    set(values: Record<string, unknown>) {
      if (pending) {
        pending.values = values
        writes.push(pending)
      }
      return builder
    },
    /**
     * A correlated subquery is built — and finished by its own `where` — while
     * its enclosing statement is still open, so a completed select is popped
     * here to let the outer statement's `where` land on the outer select.
     */
    where(condition: unknown) {
      if (pending) {
        pending.where = condition
        pending = null
        return builder
      }
      while (selects.length > 1 && top()?.where !== undefined) selects.pop()
      const select = top()
      if (select && select.where === undefined) select.where = condition
      return builder
    },
    then(onFulfilled: (value: unknown) => unknown) {
      const select = selects.pop() ?? null
      const rows = select ? evaluate(select) : (queue.shift() ?? [])
      return Promise.resolve(rows).then(onFulfilled)
    },
  }

  return { tx: builder as never, writes, remaining: () => queue.length }
}

const archivedRow = (id: string, serverId: string, toolName: string, updatedAt?: Date) => ({
  id,
  serverId,
  toolName,
  toolDescription: null,
  parameterSchema: { type: 'object', properties: {} },
  updatedAt,
})

/**
 * Restore counts the workflow's live server memberships twice — once to bound
 * the candidate query, once under the candidate locks to make the budget
 * authoritative — so a fixture with no live registrations queues this twice.
 */
const NO_LIVE_SERVERS: unknown[] = []

const liveServerRows = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    serverId: `srv-live-${String(index).padStart(3, '0')}`,
  }))

const toolRow = (id: string, serverId: string) => ({
  id,
  serverId,
  toolName: `tool_${id}`,
  toolDescription: null,
  parameterDescriptionOverrides: {},
})

describe('workflow MCP tool withdrawal and restore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.acquireLock.mockResolvedValue(undefined)
    mocks.usageRows.mockResolvedValue([])
    mocks.exceedsBudget.mockReturnValue(false)
    mocks.hasValidStartBlock.mockReturnValue(true)
  })

  /**
   * Undeploy used to DELETE every registration publishing the workflow, so a
   * redeploy could not bring them back and each server entry had to be
   * re-created by hand. Deploy/undeploy is a reversible lifecycle; only an
   * explicit tool delete is destructive.
   */
  it('archives registrations on withdrawal instead of destroying them', async () => {
    const { tx, writes } = createFakeTx([[toolRow('t-1', 'srv-1')], []])

    const servers = await removeMcpToolsForWorkflow(WORKFLOW_ID, REQUEST_ID, tx, true)

    expect(servers).toEqual([{ serverId: 'srv-1' }])
    expect(writes.some((write) => write.op === 'delete')).toBe(false)
    const archive = writes.find((write) => write.op === 'update')
    expect(archive?.table).toBe(workflowMcpTool)
    expect(archive?.values?.archivedAt).toBeInstanceOf(Date)
    expect(hasMockCondition(archive?.where, (node) => node.type === 'isNull')).toBe(true)
  })

  /**
   * Redeploying republishes the workflow on exactly the servers it was
   * published on before the undeploy.
   */
  it('restores archived registrations when the workflow is deployed again', async () => {
    const { tx, writes } = createFakeTx([
      NO_LIVE_SERVERS,
      [archivedRow('t-1', 'srv-1', 'orders')],
      NO_LIVE_SERVERS,
      [],
      [],
      [toolRow('t-1', 'srv-1')],
      [],
      [],
    ])

    await syncMcpToolsForWorkflow({
      workflowId: WORKFLOW_ID,
      requestId: REQUEST_ID,
      state: { blocks: {} },
      tx,
      notify: false,
      throwOnError: true,
    })

    const restore = writes.find((write) => write.values?.archivedAt === null)
    expect(restore).toBeDefined()
    expect(restore?.table).toBe(workflowMcpTool)
    expect(
      hasMockCondition(
        restore?.where,
        (node) => node.type === 'inArray' && (node.values as string[]).includes('t-1')
      )
    ).toBe(true)
    expect(mocks.acquireLock).toHaveBeenCalledWith(tx, 'srv-1')
  })

  /**
   * `workflow_mcp_tool_server_workflow_unique` only covers unarchived rows, so
   * reviving a second live row for a server that already has one would violate
   * it on commit.
   */
  it('never restores onto a server that already carries a live registration', async () => {
    const { tx, writes } = createFakeTx([
      NO_LIVE_SERVERS,
      [archivedRow('t-archived', 'srv-1', 'orders')],
      NO_LIVE_SERVERS,
      [{ id: 't-live', toolName: 'invoices', workflowId: WORKFLOW_ID }],
      [],
      [],
    ])

    await syncMcpToolsForWorkflow({
      workflowId: WORKFLOW_ID,
      requestId: REQUEST_ID,
      state: { blocks: {} },
      tx,
      notify: false,
      throwOnError: true,
    })

    expect(writes.some((write) => write.values?.archivedAt === null)).toBe(false)
  })
  /**
   * Repeated undeploy/skipped-restore/manual-re-add cycles stack several
   * archived generations on one server. Bounding the candidate query by ROWS
   * let those duplicates consume the whole budget, so every other server the
   * workflow was published on fell out of the result and stayed unavailable
   * after an otherwise successful redeploy. The bound must apply to servers,
   * which means deduping to one row per server first.
   */
  it('restores every distinct server even when one server has more archived generations than the bound', async () => {
    const duplicates = Array.from({ length: MAX_MCP_SERVERS_PER_WORKFLOW }, (_, index) =>
      archivedRow(`t-dup-${index}`, 'srv-dup', 'orders', new Date(2020, 0, 1 + index))
    )
    const newestDuplicateId = `t-dup-${MAX_MCP_SERVERS_PER_WORKFLOW - 1}`
    const { tx, writes } = createFakeTx([
      NO_LIVE_SERVERS,
      [
        ...duplicates,
        archivedRow('t-2', 'srv-2', 'orders', new Date(2020, 5, 1)),
        archivedRow('t-3', 'srv-3', 'orders', new Date(2020, 5, 2)),
      ],
      NO_LIVE_SERVERS,
      [],
      [],
      [],
      [],
    ])

    await syncMcpToolsForWorkflow({
      workflowId: WORKFLOW_ID,
      requestId: REQUEST_ID,
      state: { blocks: {} },
      tx,
      notify: false,
      throwOnError: true,
    })

    expect(mocks.acquireLock.mock.calls.map((call) => call[1])).toEqual([
      'srv-2',
      'srv-3',
      'srv-dup',
    ])
    const restore = writes.find((write) => write.values?.archivedAt === null)
    expect(
      hasMockCondition(
        restore?.where,
        (node) => node.type === 'inArray' && (node.values as string[]).includes('t-2')
      )
    ).toBe(true)
    expect(
      hasMockCondition(
        restore?.where,
        (node) => node.type === 'inArray' && (node.values as string[]).includes('t-3')
      )
    ).toBe(true)
    expect(
      hasMockCondition(
        restore?.where,
        (node) => node.type === 'inArray' && (node.values as string[]).includes(newestDuplicateId)
      )
    ).toBe(true)
    expect(
      hasMockCondition(
        restore?.where,
        (node) => node.type === 'inArray' && (node.values as string[]).includes('t-dup-0')
      )
    ).toBe(false)
  })

  /**
   * `DISTINCT ON (server_id)` forces `server_id` to lead the ORDER BY, so
   * bounding that statement directly keeps the lexicographically lowest server
   * ids rather than the servers the workflow most recently published on. A
   * workflow archived across more than `MAX_MCP_SERVERS_PER_WORKFLOW` servers
   * would then come back on stale servers and leave its current ones archived.
   * Deduplication and the recency bound must therefore be separate stages.
   */
  it('bounds the restore by the most recently used servers, not the lowest server ids', async () => {
    const overflow = 2
    const rows = Array.from({ length: MAX_MCP_SERVERS_PER_WORKFLOW + overflow }, (_, index) =>
      archivedRow(
        `t-${String(index).padStart(3, '0')}`,
        `srv-${String(index).padStart(3, '0')}`,
        'orders',
        new Date(2020, 0, 1 + index)
      )
    )

    const { tx, writes } = createFakeTx([NO_LIVE_SERVERS, rows, NO_LIVE_SERVERS])

    await syncMcpToolsForWorkflow({
      workflowId: WORKFLOW_ID,
      requestId: REQUEST_ID,
      state: { blocks: {} },
      tx,
      notify: false,
      throwOnError: true,
    })

    const lockedServers = mocks.acquireLock.mock.calls.map((call) => call[1])
    expect(lockedServers).toHaveLength(MAX_MCP_SERVERS_PER_WORKFLOW)
    expect(lockedServers).toEqual([...lockedServers].sort())
    expect(lockedServers).not.toContain('srv-000')
    expect(lockedServers).not.toContain('srv-001')
    expect(lockedServers).toContain(
      `srv-${String(MAX_MCP_SERVERS_PER_WORKFLOW + 1).padStart(3, '0')}`
    )

    const restore = writes.find((write) => write.values?.archivedAt === null)
    const restoredIds = flattenMockConditions(restore?.where).find(
      (node) => node.type === 'inArray'
    )?.values as string[]
    expect(restoredIds).toHaveLength(MAX_MCP_SERVERS_PER_WORKFLOW)
    expect(restoredIds).not.toContain('t-000')
    expect(restoredIds).not.toContain('t-001')
    expect(restoredIds).toContain(`t-${String(MAX_MCP_SERVERS_PER_WORKFLOW + 1).padStart(3, '0')}`)
  })

  /**
   * Archiving frees the server slot, so the servers a workflow is live on and
   * the servers it has archived registrations on are disjoint budgets that both
   * count towards `MAX_MCP_SERVERS_PER_WORKFLOW`. Bounding the candidate query
   * at the whole limit let a workflow that had been partly re-registered by
   * hand restore a full limit's worth on top of its live registrations; the
   * fanout check that runs immediately afterwards in the same deploy
   * transaction then threw and rolled the deployment back. The bound must be
   * the REMAINING headroom, and the candidates that fit it must be the most
   * recently used servers.
   */
  it('restores only as many servers as the workflow fanout budget still allows', async () => {
    const headroom = 2
    const liveServers = liveServerRows(MAX_MCP_SERVERS_PER_WORKFLOW - headroom)
    const candidates = Array.from({ length: 5 }, (_, index) =>
      archivedRow(
        `t-arch-${index}`,
        `srv-arch-${index}`,
        `orders_${index}`,
        new Date(2020, 0, 1 + index)
      )
    )

    const { tx, writes } = createFakeTx([liveServers, candidates, liveServers, [], []])

    await syncMcpToolsForWorkflow({
      workflowId: WORKFLOW_ID,
      requestId: REQUEST_ID,
      state: { blocks: {} },
      tx,
      notify: false,
      throwOnError: true,
    })

    expect(mocks.acquireLock.mock.calls.map((call) => call[1])).toEqual([
      'srv-arch-3',
      'srv-arch-4',
    ])

    const restore = writes.find((write) => write.values?.archivedAt === null)
    const restoredIds = flattenMockConditions(restore?.where).find(
      (node) => node.type === 'inArray'
    )?.values as string[]
    expect(restoredIds).toEqual(['t-arch-4', 't-arch-3'])
    expect(liveServers.length + restoredIds.length).toBeLessThanOrEqual(
      MAX_MCP_SERVERS_PER_WORKFLOW
    )
  })

  /**
   * A `(server, workflow)` pair can hold both a live row and archived
   * generations: `workflow_mcp_tool_server_workflow_unique` is scoped to
   * unarchived rows, so it constrains only the live one. Such a server was
   * counted twice — once by the live-server count that shrinks the budget, once
   * as a candidate — and the slot it consumed was spent on a candidate the
   * post-lock liveness check could only ever skip, leaving a genuinely
   * restorable server beyond the bound unfetched. The candidate query must
   * exclude it so the budget and the candidate set agree.
   */
  it('never spends a restore slot on a server the workflow is already live on', async () => {
    const headroom = 2
    const sharedServerId = 'srv-shared'
    const liveServers = [
      ...liveServerRows(MAX_MCP_SERVERS_PER_WORKFLOW - headroom - 1),
      { serverId: sharedServerId },
    ]
    const candidates = [
      archivedRow('t-arch-a', 'srv-arch-a', 'orders_a', new Date(2020, 0, 1)),
      archivedRow('t-arch-b', 'srv-arch-b', 'orders_b', new Date(2020, 0, 2)),
      archivedRow('t-arch-shared', sharedServerId, 'orders_shared', new Date(2020, 0, 3)),
    ]

    const { tx, writes } = createFakeTx(
      [liveServers, candidates, liveServers, [], [], []],
      [sharedServerId]
    )

    await syncMcpToolsForWorkflow({
      workflowId: WORKFLOW_ID,
      requestId: REQUEST_ID,
      state: { blocks: {} },
      tx,
      notify: false,
      throwOnError: true,
    })

    expect(mocks.acquireLock.mock.calls.map((call) => call[1])).toEqual([
      'srv-arch-a',
      'srv-arch-b',
    ])

    const restore = writes.find((write) => write.values?.archivedAt === null)
    const restoredIds = flattenMockConditions(restore?.where).find(
      (node) => node.type === 'inArray'
    )?.values as string[]
    expect(restoredIds).toEqual(['t-arch-b', 't-arch-a'])
  })

  /**
   * The headroom that bounds the candidate query is read before any lock is
   * taken, so a manual `tools create` on another server can consume part of it
   * in between. The budget is therefore recounted once every candidate server
   * is locked and spent one unit per accepted candidate, and the candidates
   * that survive the smaller budget are still the most recent ones.
   */
  it('re-reads the fanout budget under the locks and drops the least recent candidate', async () => {
    const preLockLiveServers = liveServerRows(MAX_MCP_SERVERS_PER_WORKFLOW - 2)
    const underLockLiveServers = liveServerRows(MAX_MCP_SERVERS_PER_WORKFLOW - 1)
    const candidates = Array.from({ length: 5 }, (_, index) =>
      archivedRow(
        `t-arch-${index}`,
        `srv-arch-${index}`,
        `orders_${index}`,
        new Date(2020, 0, 1 + index)
      )
    )

    const { tx, writes } = createFakeTx([
      preLockLiveServers,
      candidates,
      underLockLiveServers,
      [],
      [],
    ])

    await syncMcpToolsForWorkflow({
      workflowId: WORKFLOW_ID,
      requestId: REQUEST_ID,
      state: { blocks: {} },
      tx,
      notify: false,
      throwOnError: true,
    })

    const restore = writes.find((write) => write.values?.archivedAt === null)
    const restoredIds = flattenMockConditions(restore?.where).find(
      (node) => node.type === 'inArray'
    )?.values as string[]
    expect(restoredIds).toEqual(['t-arch-4'])
  })

  /**
   * A manual `tools create` on the same server can commit between a pre-lock
   * uniqueness read and the lock. Reading live rows before the lock therefore
   * proves nothing: restore would un-archive a second live row for the same
   * `(server_id, workflow_id)`, violate
   * `workflow_mcp_tool_server_workflow_unique` on commit, and roll back the
   * whole deploy. The queued read here answers differently once the lock has
   * been taken, exactly as the database would.
   */
  it('sees a live registration that appears only after the lock is taken', async () => {
    let concurrentCreateCommitted = false
    mocks.acquireLock.mockImplementation(async () => {
      concurrentCreateCommitted = true
    })

    const { tx, writes } = createFakeTx([
      NO_LIVE_SERVERS,
      [archivedRow('t-archived', 'srv-1', 'orders')],
      NO_LIVE_SERVERS,
      () =>
        concurrentCreateCommitted
          ? [{ id: 't-live', toolName: 'invoices', workflowId: WORKFLOW_ID }]
          : [],
      [],
      [],
    ])

    await syncMcpToolsForWorkflow({
      workflowId: WORKFLOW_ID,
      requestId: REQUEST_ID,
      state: { blocks: {} },
      tx,
      notify: false,
      throwOnError: true,
    })

    expect(mocks.acquireLock).toHaveBeenCalledWith(tx, 'srv-1')
    expect(writes.some((write) => write.values?.archivedAt === null)).toBe(false)
  })

  /**
   * Archiving frees the tool name: the create-path collision query skips
   * archived rows, so another workflow can take `orders` while this one is
   * undeployed. Restoring blindly would leave the server serving two live
   * tools named `orders`, which no database constraint catches.
   */
  it('leaves a candidate archived when its tool name is taken by a live tool', async () => {
    const { tx, writes } = createFakeTx([
      NO_LIVE_SERVERS,
      [archivedRow('t-archived', 'srv-1', 'orders')],
      NO_LIVE_SERVERS,
      [{ id: 't-other', toolName: 'orders' }],
      [],
      [],
      [],
    ])

    await syncMcpToolsForWorkflow({
      workflowId: WORKFLOW_ID,
      requestId: REQUEST_ID,
      state: { blocks: {} },
      tx,
      notify: false,
      throwOnError: true,
    })

    expect(mocks.acquireLock).toHaveBeenCalledWith(tx, 'srv-1')
    expect(writes.some((write) => write.values?.archivedAt === null)).toBe(false)
  })

  /**
   * Archiving also frees the server slot, so a restore can push a server past
   * MAX_MCP_TOOLS_PER_SERVER that the create path would have rejected.
   */
  it('leaves a candidate archived when the server is already at the tool cap', async () => {
    const liveTools = Array.from({ length: MAX_MCP_TOOLS_PER_SERVER }, (_, index) => ({
      id: `t-live-${index}`,
      toolName: `tool_${index}`,
    }))
    const { tx, writes } = createFakeTx([
      NO_LIVE_SERVERS,
      [archivedRow('t-archived', 'srv-1', 'orders')],
      NO_LIVE_SERVERS,
      liveTools,
      [],
      [],
      [],
    ])

    await syncMcpToolsForWorkflow({
      workflowId: WORKFLOW_ID,
      requestId: REQUEST_ID,
      state: { blocks: {} },
      tx,
      notify: false,
      throwOnError: true,
    })

    expect(writes.some((write) => write.values?.archivedAt === null)).toBe(false)
  })

  /**
   * A restore that pushes the server past its tools/list metadata budget breaks
   * the server for every consumer with no recovery path, so the candidate stays
   * archived instead.
   */
  it('leaves a candidate archived when restoring it would exceed the metadata budget', async () => {
    mocks.exceedsBudget.mockReturnValue(true)
    const { tx, writes } = createFakeTx([
      NO_LIVE_SERVERS,
      [archivedRow('t-archived', 'srv-1', 'orders')],
      NO_LIVE_SERVERS,
      [],
      [],
      [],
      [],
    ])

    await syncMcpToolsForWorkflow({
      workflowId: WORKFLOW_ID,
      requestId: REQUEST_ID,
      state: { blocks: {} },
      tx,
      notify: false,
      throwOnError: true,
    })

    expect(mocks.exceedsBudget).toHaveBeenCalled()
    expect(writes.some((write) => write.values?.archivedAt === null)).toBe(false)
  })
})

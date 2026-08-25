/**
 * @vitest-environment node
 */
import { hasMockCondition } from '@sim/testing'
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
import { MAX_MCP_TOOLS_PER_SERVER } from '@/lib/mcp/constants'
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
 * Minimal drizzle chain over an ordered queue of results, so the sync's exact
 * statement sequence — and whether a withdrawal deletes or archives — is
 * observable without a live database.
 */
function createFakeTx(results: unknown[]) {
  const writes: RecordedWrite[] = []
  const queue = [...results]
  let pending: RecordedWrite | null = null

  const builder: Record<string, unknown> = {
    select: () => builder,
    from: () => builder,
    orderBy: () => builder,
    limit: () => builder,
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
    where(condition: unknown) {
      if (pending) pending.where = condition
      pending = null
      return builder
    },
    then(onFulfilled: (value: unknown) => unknown) {
      return Promise.resolve(queue.shift() ?? []).then(onFulfilled)
    },
  }

  return { tx: builder as never, writes, remaining: () => queue.length }
}

const archivedRow = (id: string, serverId: string, toolName: string) => ({
  id,
  serverId,
  toolName,
  toolDescription: null,
  parameterSchema: { type: 'object', properties: {} },
})

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
      [archivedRow('t-1', 'srv-1', 'orders')],
      [],
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
      [archivedRow('t-archived', 'srv-1', 'orders')],
      [{ serverId: 'srv-1' }],
      [toolRow('t-live', 'srv-1')],
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
   * Archiving frees the tool name: the create-path collision query skips
   * archived rows, so another workflow can take `orders` while this one is
   * undeployed. Restoring blindly would leave the server serving two live
   * tools named `orders`, which no database constraint catches.
   */
  it('leaves a candidate archived when its tool name is taken by a live tool', async () => {
    const { tx, writes } = createFakeTx([
      [archivedRow('t-archived', 'srv-1', 'orders')],
      [],
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
      [archivedRow('t-archived', 'srv-1', 'orders')],
      [],
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
      [archivedRow('t-archived', 'srv-1', 'orders')],
      [],
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

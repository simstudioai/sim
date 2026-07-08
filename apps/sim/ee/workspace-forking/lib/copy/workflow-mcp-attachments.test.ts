/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

const { mockGetEdgeMappingRows, mockAcquireLock } = vi.hoisted(() => ({
  mockGetEdgeMappingRows: vi.fn(),
  mockAcquireLock: vi.fn(),
}))

vi.mock('@/ee/workspace-forking/lib/mapping/mapping-store', () => ({
  getEdgeMappingRows: mockGetEdgeMappingRows,
}))
vi.mock('@/lib/mcp/server-locks', () => ({
  acquireWorkflowMcpServerLock: mockAcquireLock,
}))

import type { DbOrTx } from '@/lib/db/types'
import {
  copyForkWorkflowMcpAttachments,
  reconcileForkWorkflowMcpAttachments,
} from '@/ee/workspace-forking/lib/copy/workflow-mcp-attachments'

/** Sequenced select mock + captured inserts/updates. */
function makeTx(selectResults: unknown[][]) {
  const inserted: Array<Record<string, unknown>> = []
  const updates: Array<Record<string, unknown>> = []
  let call = 0
  const select = vi.fn(() => ({
    from: () => ({ where: () => Promise.resolve(selectResults[call++] ?? []) }),
  }))
  const tx = {
    select,
    insert: () => ({
      values: (values: Array<Record<string, unknown>>) => {
        inserted.push(...values)
        return Promise.resolve()
      },
    }),
    update: () => ({
      set: (set: Record<string, unknown>) => ({
        where: () => {
          updates.push(set)
          return Promise.resolve()
        },
      }),
    }),
  }
  return { tx: tx as unknown as DbOrTx, inserted, updates, select }
}

const attachment = (overrides: Record<string, unknown> = {}) => ({
  serverId: 'srv-src',
  workflowId: 'wf-src',
  toolName: 'run_support_flow',
  toolDescription: 'Runs the support flow',
  parameterSchema: { type: 'object', properties: {} },
  parameterDescriptionOverrides: {},
  ...overrides,
})

const serverMappingRow = {
  id: 'map-1',
  childWorkspaceId: 'child-ws',
  resourceType: 'workflow_mcp_server' as const,
  parentResourceId: 'srv-parent',
  childResourceId: 'srv-child',
}

describe('reconcileForkWorkflowMcpAttachments', () => {
  it('creates the target attachment for a mapped server + written pair (push: child -> parent)', async () => {
    mockGetEdgeMappingRows.mockResolvedValue([serverMappingRow])
    mockAcquireLock.mockClear()
    const { tx, inserted, select } = makeTx([
      [{ id: 'srv-child' }, { id: 'srv-parent' }], // both mapped servers still live
      [attachment({ serverId: 'srv-child', workflowId: 'wf-child' })],
      [], // no existing target attachments
    ])
    const result = await reconcileForkWorkflowMcpAttachments({
      tx,
      childWorkspaceId: 'child-ws',
      sourceIsParent: false, // push: source is the child
      now: new Date(),
      writtenPairs: [{ sourceWorkflowId: 'wf-child', targetWorkflowId: 'wf-parent' }],
    })
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({
      serverId: 'srv-parent',
      workflowId: 'wf-parent',
      toolName: 'run_support_flow',
    })
    expect(result.affectedServerIds).toEqual(['srv-parent'])
    expect(mockAcquireLock).toHaveBeenCalledWith(tx, 'srv-parent')
    // The lock must precede every read: locking after the diff is computed would let a
    // concurrent attach commit in between and abort the promote on the unique constraint.
    expect(mockAcquireLock.mock.invocationCallOrder[0]).toBeLessThan(
      select.mock.invocationCallOrder[0]
    )
  })

  it('archives a target attachment whose source counterpart was detached', async () => {
    mockGetEdgeMappingRows.mockResolvedValue([serverMappingRow])
    const { tx, inserted, updates } = makeTx([
      [{ id: 'srv-child' }, { id: 'srv-parent' }], // both mapped servers still live
      [], // source has no attachments left
      [
        {
          id: 'tool-tgt',
          serverId: 'srv-parent',
          workflowId: 'wf-parent',
          toolName: 'run_support_flow',
          toolDescription: null,
          parameterDescriptionOverrides: {},
        },
      ],
    ])
    const result = await reconcileForkWorkflowMcpAttachments({
      tx,
      childWorkspaceId: 'child-ws',
      sourceIsParent: false,
      now: new Date(),
      writtenPairs: [{ sourceWorkflowId: 'wf-child', targetWorkflowId: 'wf-parent' }],
    })
    expect(inserted).toHaveLength(0)
    expect(updates).toHaveLength(1)
    expect(updates[0].archivedAt).toBeInstanceOf(Date)
    expect(result.affectedServerIds).toEqual(['srv-parent'])
  })

  it('refreshes drifted metadata on an existing target attachment', async () => {
    mockGetEdgeMappingRows.mockResolvedValue([serverMappingRow])
    const { tx, updates } = makeTx([
      [{ id: 'srv-child' }, { id: 'srv-parent' }], // both mapped servers still live
      [attachment({ serverId: 'srv-child', workflowId: 'wf-child', toolName: 'renamed_tool' })],
      [
        {
          id: 'tool-tgt',
          serverId: 'srv-parent',
          workflowId: 'wf-parent',
          toolName: 'run_support_flow',
          toolDescription: 'Runs the support flow',
          parameterDescriptionOverrides: {},
        },
      ],
    ])
    await reconcileForkWorkflowMcpAttachments({
      tx,
      childWorkspaceId: 'child-ws',
      sourceIsParent: false,
      now: new Date(),
      writtenPairs: [{ sourceWorkflowId: 'wf-child', targetWorkflowId: 'wf-parent' }],
    })
    expect(updates).toHaveLength(1)
    expect(updates[0].toolName).toBe('renamed_tool')
  })

  it('skips a mapped pair whose target server was deleted (stale identity row must never FK-crash the sync)', async () => {
    mockGetEdgeMappingRows.mockResolvedValue([serverMappingRow])
    const { tx, inserted } = makeTx([
      [{ id: 'srv-child' }], // target server srv-parent hard-deleted: only the source is live
    ])
    const result = await reconcileForkWorkflowMcpAttachments({
      tx,
      childWorkspaceId: 'child-ws',
      sourceIsParent: false,
      now: new Date(),
      writtenPairs: [{ sourceWorkflowId: 'wf-child', targetWorkflowId: 'wf-parent' }],
    })
    expect(inserted).toHaveLength(0)
    expect(result.affectedServerIds).toEqual([])
  })

  it('no-ops with no mapped servers (attachments follow the server identity)', async () => {
    mockGetEdgeMappingRows.mockResolvedValue([
      { ...serverMappingRow, resourceType: 'table' as const },
    ])
    const { tx, inserted } = makeTx([])
    const result = await reconcileForkWorkflowMcpAttachments({
      tx,
      childWorkspaceId: 'child-ws',
      sourceIsParent: false,
      now: new Date(),
      writtenPairs: [{ sourceWorkflowId: 'wf-child', targetWorkflowId: 'wf-parent' }],
    })
    expect(inserted).toHaveLength(0)
    expect(result.affectedServerIds).toEqual([])
  })
})

describe('copyForkWorkflowMcpAttachments', () => {
  it('copies an attachment only when BOTH its server and workflow were copied', async () => {
    const { tx, inserted } = makeTx([
      [
        attachment(), // both mapped
        attachment({ serverId: 'srv-uncopied', workflowId: 'wf-src' }),
        attachment({ serverId: 'srv-src', workflowId: 'wf-uncopied' }),
      ],
    ])
    const result = await copyForkWorkflowMcpAttachments({
      tx,
      serverIdMap: new Map([['srv-src', 'srv-copy']]),
      workflowIdMap: new Map([['wf-src', 'wf-copy']]),
      now: new Date(),
    })
    expect(result.copied).toBe(1)
    expect(inserted[0]).toMatchObject({
      serverId: 'srv-copy',
      workflowId: 'wf-copy',
      toolName: 'run_support_flow',
    })
  })

  it('no-ops when either id map is empty', async () => {
    const { tx, inserted } = makeTx([])
    const result = await copyForkWorkflowMcpAttachments({
      tx,
      serverIdMap: new Map(),
      workflowIdMap: new Map([['wf-src', 'wf-copy']]),
      now: new Date(),
    })
    expect(result.copied).toBe(0)
    expect(inserted).toHaveLength(0)
  })
})

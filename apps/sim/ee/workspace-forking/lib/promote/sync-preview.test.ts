/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  measureTargetDraftBytes: vi.fn(),
  forEachTargetDraft: vi.fn(),
}))

vi.mock('@/ee/workspace-forking/lib/copy/deploy-bridge', () => ({
  MAX_FORK_STATE_BYTES: 1000,
  measureTargetDraftBytes: mocks.measureTargetDraftBytes,
  forEachTargetDraft: mocks.forEachTargetDraft,
}))

import {
  listUnchangedSyncSources,
  projectSyncSource,
  syncChangesWorkflow,
} from '@/ee/workspace-forking/lib/promote/sync-preview'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

function state(code: string, blockId = 'b1', extra: Record<string, unknown> = {}): WorkflowState {
  return {
    blocks: {
      [blockId]: {
        id: blockId,
        type: 'function',
        name: 'Run',
        position: { x: 0, y: 0 },
        subBlocks: { code: { id: 'code', type: 'code', value: code } },
        outputs: {},
        enabled: true,
        ...extra,
      },
    },
    edges: [],
    loops: {},
    parallels: {},
    variables: {},
  } as unknown as WorkflowState
}

/** Every source block pairs with the target block named `t-<id>`, as a recorded block map would. */
const resolve = (_targetWorkflowId: string, sourceBlockId: string) => `t-${sourceBlockId}`

describe('syncChangesWorkflow', () => {
  it('reports no change when the target draft already matches the projected source', () => {
    const before = state('return 1', 't-b1')
    const after = projectSyncSource(state('return 1'), before, 'wf-t', resolve)

    expect(syncChangesWorkflow(before, after)).toBe(false)
  })

  it('reports a change when a field differs', () => {
    const before = state('return 1', 't-b1')
    const after = projectSyncSource(state('return 2'), before, 'wf-t', resolve)

    expect(syncChangesWorkflow(before, after)).toBe(true)
  })

  it('ignores canvas-only presentation, as the comparison view does', () => {
    const before = state('return 1', 't-b1')
    const after = projectSyncSource(
      state('return 1', 'b1', { horizontalHandles: false }),
      before,
      'wf-t',
      resolve
    )

    expect(syncChangesWorkflow(before, after)).toBe(false)
  })

  it('always reports a change for a workflow the sync creates', () => {
    expect(syncChangesWorkflow(null, state('return 1'))).toBe(true)
  })
})

describe('listUnchangedSyncSources', () => {
  const items = [
    { sourceWorkflowId: 's-same', targetWorkflowId: 't-same', mode: 'replace' },
    { sourceWorkflowId: 's-diff', targetWorkflowId: 't-diff', mode: 'replace' },
    { sourceWorkflowId: 's-new', targetWorkflowId: 't-new', mode: 'create' },
  ] as unknown as Parameters<typeof listUnchangedSyncSources>[0]['items']
  const sourceStates = new Map([
    ['s-same', state('return 1')],
    ['s-diff', state('return 2')],
    ['s-new', state('return 3')],
  ])
  const drafts = new Map([
    ['t-same', state('return 1', 't-b1')],
    ['t-diff', state('return 1', 't-b1')],
  ])

  beforeEach(() => {
    mocks.measureTargetDraftBytes.mockResolvedValue(10)
    mocks.forEachTargetDraft.mockImplementation(
      async (
        ids: string[],
        _workspaceId: string,
        visit: (id: string, d: WorkflowState) => void
      ) => {
        for (const id of ids) {
          const draft = drafts.get(id)
          if (draft) visit(id, draft)
        }
      }
    )
  })

  it('lists only replaced workflows whose draft already matches, reading replaced targets only', async () => {
    const unchanged = await listUnchangedSyncSources({
      items,
      sourceStates,
      targetWorkspaceId: 'ws-t',
      resolveBlockId: resolve,
    })

    expect([...unchanged]).toEqual(['s-same'])
  })

  /* `s-same` would be listed if any draft were read, so an empty result shows none was. */
  it('reads no drafts and treats everything as changed when the drafts exceed the limit', async () => {
    mocks.measureTargetDraftBytes.mockResolvedValue(5000)

    const unchanged = await listUnchangedSyncSources({
      items,
      sourceStates,
      targetWorkspaceId: 'ws-t',
      resolveBlockId: resolve,
    })

    expect(unchanged.size).toBe(0)
  })
})

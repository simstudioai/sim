/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ForkReferenceResolver } from '@/ee/workspace-forking/lib/remap/remap-references'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const { mockResolveBinding } = vi.hoisted(() => ({ mockResolveBinding: vi.fn() }))

vi.mock('@/lib/workflows/custom-blocks/operations', () => ({
  resolveCustomBlockToolBinding: mockResolveBinding,
}))

import { collectForkCustomBlockReconfigs } from '@/ee/workspace-forking/lib/mapping/custom-block-reconfigs'

const PROD = 'custom_block_prod01'
const UAT = 'custom_block_uat0001'

function stateWith(blocks: Record<string, { type: string; name: string }>): WorkflowState {
  return {
    blocks: Object.fromEntries(
      Object.entries(blocks).map(([id, b]) => [
        id,
        { id, type: b.type, name: b.name, position: { x: 0, y: 0 }, subBlocks: {}, outputs: {} },
      ])
    ),
    edges: [],
    loops: {},
    parallels: {},
  } as unknown as WorkflowState
}

const baseParams = {
  items: [{ sourceWorkflowId: 'wf-src', targetWorkflowId: 'wf-tgt' }],
  sourceStates: new Map([
    ['wf-src', stateWith({ 'blk-cb': { type: UAT, name: 'Invoice Parser' } })],
  ]),
  resolveTargetBlockId: (_t: string, sourceBlockId: string) => `tgt-${sourceBlockId}`,
  targetWorkspaceId: 'ws-parent',
}

/** Maps the placed UAT block onto the PROD block, i.e. a real repoint. */
const swapResolver: ForkReferenceResolver = (kind, sourceId) =>
  kind === 'custom-block' && sourceId === UAT ? PROD : null

describe('collectForkCustomBlockReconfigs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolveBinding.mockResolvedValue({
      workflowId: 'wf-prod-impl',
      inputFields: [
        { id: 'field-a', name: 'Invoice URL', type: 'string' },
        { id: 'field-b', name: 'Options', type: 'object' },
      ],
      requiredInputIds: ['field-a'],
    })
  })

  it('offers every input of the target block, keyed by the field id the canvas reads', async () => {
    const out = await collectForkCustomBlockReconfigs({ ...baseParams, resolve: swapResolver })

    expect(out).toHaveLength(2)
    // Namespaced by TARGET type and FIELD type: re-pointing the block again cannot reuse these
    // values, and the apply side can restore a boolean's real type without a second lookup.
    expect(out.map((f) => f.subBlockKey)).toEqual([
      `${PROD}::string::field-a`,
      `${PROD}::object::field-b`,
    ])
    expect(out[0]).toMatchObject({
      parentKind: 'custom-block',
      // Joined to its own mapping row on (parentKind, parentSourceId) — the SOURCE type is
      // exactly what the mapping entry's sourceId is.
      parentSourceId: UAT,
      targetWorkflowId: 'wf-tgt',
      targetBlockId: 'tgt-blk-cb',
      title: 'Invoice URL',
      fieldType: 'string',
      required: true,
    })
    expect(out[1].required).toBe(false)
  })

  it('never seeds the source value — it belongs to a different block', async () => {
    const out = await collectForkCustomBlockReconfigs({ ...baseParams, resolve: swapResolver })

    expect(out.every((f) => f.currentValue === '' && f.sourceValue === '')).toBe(true)
  })

  it('offers nothing when the type does not change', async () => {
    // No mapping, or an explicit identity mapping: the field ids still describe this block, so
    // its values carry across and there is nothing to re-pick.
    expect(
      await collectForkCustomBlockReconfigs({ ...baseParams, resolve: () => null })
    ).toHaveLength(0)
    expect(
      await collectForkCustomBlockReconfigs({ ...baseParams, resolve: (_k, id) => id })
    ).toHaveLength(0)
    expect(mockResolveBinding).not.toHaveBeenCalled()
  })

  it('ignores non-custom blocks entirely', async () => {
    const out = await collectForkCustomBlockReconfigs({
      ...baseParams,
      sourceStates: new Map([['wf-src', stateWith({ a: { type: 'agent', name: 'Agent 1' } })]]),
      resolve: swapResolver,
    })

    expect(out).toHaveLength(0)
  })

  it('resolves each distinct target type once, not once per placement', async () => {
    const out = await collectForkCustomBlockReconfigs({
      ...baseParams,
      sourceStates: new Map([
        [
          'wf-src',
          stateWith({
            'blk-1': { type: UAT, name: 'Parse A' },
            'blk-2': { type: UAT, name: 'Parse B' },
          }),
        ],
      ]),
      resolve: swapResolver,
    })

    // Two placements, each independently configurable, but one schema lookup.
    expect(mockResolveBinding).toHaveBeenCalledTimes(1)
    expect(new Set(out.map((f) => f.targetBlockId))).toEqual(new Set(['tgt-blk-1', 'tgt-blk-2']))
  })

  it('drops the fields rather than failing the whole diff when a target will not resolve', async () => {
    // An unresolvable target is already a sync blocker via the mapping's own existence check;
    // throwing here would hide every other finding in the diff.
    mockResolveBinding.mockResolvedValue(null)

    expect(
      await collectForkCustomBlockReconfigs({ ...baseParams, resolve: swapResolver })
    ).toHaveLength(0)
  })

  it('survives a binding lookup that throws', async () => {
    mockResolveBinding.mockRejectedValue(new Error('deployment read failed'))

    expect(
      await collectForkCustomBlockReconfigs({ ...baseParams, resolve: swapResolver })
    ).toHaveLength(0)
  })
})

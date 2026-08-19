/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  type ForkReferenceResolver,
  remapForkBlockType,
  scanWorkflowReferences,
} from '@/ee/workspace-forking/lib/remap/remap-references'

const PROD_BLOCK = 'custom_block_prodabc123'
const UAT_BLOCK = 'custom_block_uatxyz7890'

/** Resolver that only knows the one prod -> uat custom-block mapping. */
const mappedResolver: ForkReferenceResolver = (kind, sourceId) =>
  kind === 'custom-block' && sourceId === PROD_BLOCK ? UAT_BLOCK : null

const emptyResolver: ForkReferenceResolver = () => null

describe('remapForkBlockType', () => {
  it('leaves a non-custom block entirely alone', () => {
    const result = remapForkBlockType('agent', mappedResolver)
    expect(result).toEqual({ type: 'agent', remapped: false })
    expect(result.reference).toBeUndefined()
  })

  it('repoints a mapped custom block at the target environment block', () => {
    const result = remapForkBlockType(PROD_BLOCK, mappedResolver, {
      blockId: 'blk-1',
      blockName: 'Invoice Parser',
    })
    expect(result.type).toBe(UAT_BLOCK)
    expect(result.remapped).toBe(true)
    expect(result.reference).toEqual({
      kind: 'custom-block',
      sourceId: PROD_BLOCK,
      blockId: 'blk-1',
      blockName: 'Invoice Parser',
      subBlockKey: 'type',
      required: true,
    })
  })

  it('KEEPS the source type when unmapped rather than clearing it', () => {
    // Clearing a block's type would delete the node and silently drop a workflow step,
    // so an unmapped custom block stays put and is reported instead.
    const result = remapForkBlockType(PROD_BLOCK, emptyResolver)
    expect(result.type).toBe(PROD_BLOCK)
    expect(result.remapped).toBe(false)
    expect(result.reference?.sourceId).toBe(PROD_BLOCK)
  })

  it('treats a self-mapping as not remapped, so it never reports a spurious rewrite', () => {
    const selfResolver: ForkReferenceResolver = () => PROD_BLOCK
    const result = remapForkBlockType(PROD_BLOCK, selfResolver)
    expect(result.type).toBe(PROD_BLOCK)
    expect(result.remapped).toBe(false)
  })
})

describe('scanWorkflowReferences with custom blocks', () => {
  it('detects an unmapped custom block from the block type alone', () => {
    const scan = scanWorkflowReferences(
      [{ id: 'blk-1', name: 'Invoice Parser', type: PROD_BLOCK, subBlocks: {} }],
      emptyResolver
    )
    expect(scan.references).toContainEqual(
      expect.objectContaining({ kind: 'custom-block', sourceId: PROD_BLOCK })
    )
    expect(scan.unmapped).toContainEqual(
      expect.objectContaining({ kind: 'custom-block', sourceId: PROD_BLOCK })
    )
  })

  it('detects a custom block that carries no sub-blocks at all', () => {
    // The sub-block walk short-circuits on a missing/!object `subBlocks`; a custom block
    // with no inputs is still a live reference, so detection must run before that guard.
    const scan = scanWorkflowReferences(
      [{ id: 'blk-1', name: 'Ping', type: PROD_BLOCK, subBlocks: undefined }],
      emptyResolver
    )
    expect(scan.unmapped).toHaveLength(1)
    expect(scan.unmapped[0].sourceId).toBe(PROD_BLOCK)
  })

  it('reports a mapped custom block as referenced but NOT unmapped', () => {
    const scan = scanWorkflowReferences(
      [{ id: 'blk-1', name: 'Invoice Parser', type: PROD_BLOCK, subBlocks: {} }],
      mappedResolver
    )
    expect(scan.references).toHaveLength(1)
    expect(scan.unmapped).toHaveLength(0)
  })

  it('dedupes the same custom block placed in several workflows', () => {
    const scan = scanWorkflowReferences(
      [
        { id: 'blk-1', name: 'Parse A', type: PROD_BLOCK, subBlocks: {} },
        { id: 'blk-2', name: 'Parse B', type: PROD_BLOCK, subBlocks: {} },
      ],
      emptyResolver
    )
    expect(scan.unmapped).toHaveLength(1)
  })
})

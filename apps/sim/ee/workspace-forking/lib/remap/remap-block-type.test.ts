/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  customBlockInputStorageKey,
  type ForkReferenceResolver,
  remapForkBlockType,
  replaceCustomBlockInputs,
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
    expect(result).toEqual({ type: 'agent', resolved: false })
    expect(result.reference).toBeUndefined()
  })

  it('repoints a mapped custom block at the target environment block', () => {
    const result = remapForkBlockType(PROD_BLOCK, mappedResolver, {
      blockId: 'blk-1',
      blockName: 'Invoice Parser',
    })
    expect(result.type).toBe(UAT_BLOCK)
    expect(result.resolved).toBe(true)
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
    expect(result.resolved).toBe(false)
    expect(result.reference?.sourceId).toBe(PROD_BLOCK)
  })

  it('counts an explicit identity mapping as RESOLVED, so it never blocks the promote', () => {
    // The org-wide candidate list includes the source block, so binding an environment to
    // the shared block is a normal pick. Reporting it as unresolved would raise
    // `unmapped-custom-block` and refuse the sync over a choice the user explicitly made.
    const selfResolver: ForkReferenceResolver = () => PROD_BLOCK
    const result = remapForkBlockType(PROD_BLOCK, selfResolver)
    expect(result.type).toBe(PROD_BLOCK)
    expect(result.resolved).toBe(true)
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

  it('does not report an identity-mapped block as unmapped', () => {
    const selfResolver: ForkReferenceResolver = (kind, sourceId) =>
      kind === 'custom-block' ? sourceId : null
    const scan = scanWorkflowReferences(
      [{ id: 'blk-1', name: 'Shared Utility', type: PROD_BLOCK, subBlocks: {} }],
      selfResolver
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

describe('replaceCustomBlockInputs target carry-over', () => {
  /** The source block's inputs, keyed by the SOURCE block's field ids. */
  const sourceSubBlocks = {
    workflowId: { value: 'wf-prod' },
    invoice: { value: 'from prod' },
  }
  const key = (fieldType: string, fieldId: string) =>
    customBlockInputStorageKey(UAT_BLOCK, fieldType, fieldId)

  it('keeps an input the modal cannot configure when the target is already this block', () => {
    // A `file[]` input is an upload on the canvas, so it never has a stored override. Before
    // the carry-over every sync rebuilt the block without it and silently dropped the files.
    const result = replaceCustomBlockInputs(
      sourceSubBlocks,
      new Map([[key('string', 'vendor'), 'Acme']]),
      UAT_BLOCK,
      {
        type: UAT_BLOCK,
        subBlocks: {
          attachments: { value: ['uat-file-1'] },
          vendor: { value: 'stale' },
        },
      }
    )
    expect(result.attachments).toEqual({ value: ['uat-file-1'] })
    // A configured value still wins over the target's own.
    expect(result.vendor).toEqual({ value: 'Acme' })
  })

  it('carries nothing over when the target currently holds a DIFFERENT custom block', () => {
    // The target's field ids describe another workflow's Start fields; keeping them is exactly
    // the orphaning this function exists to prevent.
    const result = replaceCustomBlockInputs(sourceSubBlocks, undefined, UAT_BLOCK, {
      type: 'custom_block_someotherxyz',
      subBlocks: { attachments: { value: ['other-file'] } },
    })
    expect(result.attachments).toBeUndefined()
  })

  it('carries nothing over for a non-custom target block', () => {
    const result = replaceCustomBlockInputs(sourceSubBlocks, undefined, UAT_BLOCK, {
      type: 'agent',
      subBlocks: { systemPrompt: { value: 'hello' } },
    })
    expect(result.systemPrompt).toBeUndefined()
  })

  it('lets an explicitly emptied field clear the target value', () => {
    // `''` is a stored override, not an absent one — so clearing a field in the modal is a
    // real edit rather than a silent no-op.
    const result = replaceCustomBlockInputs(
      sourceSubBlocks,
      new Map([[key('string', 'vendor'), '']]),
      UAT_BLOCK,
      { type: UAT_BLOCK, subBlocks: { vendor: { value: 'previous' } } }
    )
    expect(result.vendor).toEqual({ value: '' })
  })

  it('takes reserved wiring from the source, never the target', () => {
    // `workflowId`/`inputMapping` are recomputed by the serializer; the target's copy is stale
    // the moment the mapping changes.
    const result = replaceCustomBlockInputs(sourceSubBlocks, undefined, UAT_BLOCK, {
      type: UAT_BLOCK,
      subBlocks: { workflowId: { value: 'wf-stale-uat' } },
    })
    expect(result.workflowId).toEqual({ value: 'wf-prod' })
  })

  it('still drops the source block-keyed inputs with no target to carry over', () => {
    const result = replaceCustomBlockInputs(sourceSubBlocks, undefined, UAT_BLOCK)
    expect(result.invoice).toBeUndefined()
    expect(result.workflowId).toEqual({ value: 'wf-prod' })
  })
})

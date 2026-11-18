/**
 * Pins the digests of one fixed stored workflow. Every checkout in the field holds a `sf1:`
 * fingerprint of canonicalize's output, so a change to canonicalize, the semantic projection or the
 * hashing makes every outstanding checkout stale on deploy. That is a format change: when this test
 * fails, bump the fingerprint prefix (`sf1:` → `sf2:`) and accept the old one for a release, rather
 * than updating the digests here.
 */
import type { BlockState, WorkflowState } from '@sim/workflow-types/workflow'
import { describe, expect, it } from 'vitest'
import { canonicalize } from '../canonicalize'
import type { BlockCatalog, CatalogBlock, CatalogSubBlock } from '../catalog/types'
import { canonicalDigests } from '.'

function block(
  type: string,
  subBlocks: CatalogSubBlock[],
  category: CatalogBlock['category'] = 'blocks'
): CatalogBlock {
  return {
    type,
    name: type,
    category,
    subBlocks,
    tools: { access: [], selector: 'single' },
    outputs: {},
    graph: { canBeTarget: true, errorPort: true, container: null, annotationOnly: false },
  }
}

const CATALOG: BlockCatalog = {
  catalogVersion: 1,
  hash: 'pinned',
  sdkMajor: 1,
  builders: {},
  triggers: {},
  blocks: {
    start_trigger: block(
      'start_trigger',
      [
        {
          id: 'inputFormat',
          type: 'input-format',
          valueKind: 'array',
          structured: 'inputFormat',
          storage: 'native',
        },
      ],
      'triggers'
    ),
    function: block('function', [
      { id: 'language', type: 'dropdown', valueKind: 'string', storage: 'native' },
      { id: 'code', type: 'code', valueKind: 'code', storage: 'native' },
    ]),
  },
}

function stored(
  id: string,
  type: string,
  name: string,
  subBlocks: BlockState['subBlocks']
): BlockState {
  return { id, type, name, position: { x: 10, y: 20 }, subBlocks, outputs: {}, enabled: true }
}

const STATE: WorkflowState = {
  blocks: {
    'blk-start': stored('blk-start', 'start_trigger', 'Start', {}),
    'blk-score': stored('blk-score', 'function', 'Score lead', {
      language: { id: 'language', type: 'dropdown', value: 'javascript' },
      code: { id: 'code', type: 'code', value: 'return <start.input>.length' },
    }),
  },
  edges: [
    {
      id: 'edge-1',
      source: 'blk-start',
      target: 'blk-score',
      sourceHandle: 'source',
      targetHandle: 'target',
    },
  ],
  loops: {},
  parallels: {},
  variables: {
    'var-1': { id: 'var-1', name: 'retries', type: 'number', value: 3 },
  },
}

describe('canonical digests', () => {
  it('stay fixed for a fixed stored workflow (a change is a fingerprint format bump)', () => {
    const { workflow, identity } = canonicalize(STATE, {
      catalog: CATALOG,
      meta: { name: 'Leads', description: null },
    })

    expect(canonicalDigests(workflow, identity)).toEqual({
      canonicalHash: '3e85ed15a09b2cf2af50e5e1386ed58f002d21f18272c5014818b528d8a33f5b',
      fingerprint: 'sf1:5b0182df664b06ce2e632a30d0e455042d2d5d538f9b9d105c19cdee30a74a46',
    })
  })
})

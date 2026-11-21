/**
 * Rename inference (identity rule 4) grows linearly with the number of renamed blocks (see
 * `expectLinearGrowth` for how a case is measured).
 */

import { expectLinearGrowth } from '@sim/testing/helpers/scaling'
import { describe, expect, it } from 'vitest'
import type { CanonicalBlock } from '../model'
import {
  blockState,
  CATALOG,
  canonical,
  edge,
  fixtureHooks,
  lockFor,
  RESOURCES,
  workflowState,
} from './fixtures.test-helpers'
import { materialize } from './index'

interface RenameShape {
  /** The readers now read the new blocks, so each pairs by its renamed references. */
  renameReaders?: boolean
  /** Every function block hangs off one hub, so every pair shares its one neighbour. */
  hub?: boolean
}

/**
 * `n` function blocks, each read by its own api block, replaced by `n` new function blocks under
 * new keys, idents and code. Without a signal ({@link RenameShape}) each new block is created.
 */
function renameAll(n: number, { renameReaders = false, hub = false }: RenameShape) {
  const prev = workflowState(
    [
      blockState('hub', 'api', 'Hub', { url: 'https://hub' }),
      ...Array.from({ length: n }, (_, i) => [
        blockState(`fn${i}`, 'function', `Old${i}`, {
          language: 'javascript',
          code: `return ${i}`,
        }),
        blockState(`rd${i}`, 'api', `Reader${i}`, { url: `https://x/<old${i}.result>` }),
      ]).flat(),
    ],
    { edges: hub ? Array.from({ length: n }, (_, i) => edge(`e${i}`, 'hub', `fn${i}`)) : [] }
  )
  const lock = lockFor(prev)
  const prevCanonical = canonical(prev, lock)
  const blocks: Record<string, CanonicalBlock> = {}
  for (const [key, block] of Object.entries(prevCanonical.workflow.blocks)) {
    if (block.type === 'function') {
      const index = key.slice('old'.length)
      const next = `new${index}`
      blocks[next] = {
        ...block,
        key: next,
        name: `New${index}`,
        params: { ...block.params, code: { kind: 'value', value: `return '${next}'` } },
      }
    } else {
      const params = JSON.stringify(block.params)
      blocks[key] = {
        ...block,
        params: JSON.parse(renameReaders ? params.replace(/<old(\d+)\./g, '<new$1.') : params),
      }
    }
  }
  const edges = prevCanonical.workflow.edges.map((link) => ({
    ...link,
    to: link.to.replace(/^old/, 'new'),
  }))
  const workflow = { ...prevCanonical.workflow, blocks, edges }
  const compiledIdents = Object.fromEntries(Object.keys(blocks).map((key) => [key, `x_${key}`]))
  return () =>
    materialize(workflow, lock, {
      catalog: CATALOG,
      hooks: fixtureHooks(),
      resources: RESOURCES,
      prev,
      prevCanonical,
      lockFreshness: 'fresh',
      compiledIdents,
    })
}

describe('materialize scaling', () => {
  it('pairs blocks renamed with their references, and nothing else', () => {
    const viaReferences = renameAll(3, { renameReaders: true })().entries
    expect(viaReferences.filter((entry) => entry.status === 'created')).toEqual([])
    expect(viaReferences).toContainEqual(
      expect.objectContaining({ status: 'matched', key: 'new1', id: 'fn1', via: 'inferred' })
    )
    for (const shape of [{}, { hub: true }]) {
      const unpaired = renameAll(3, shape)().entries
      expect(unpaired.filter((entry) => entry.status === 'created')).toHaveLength(3)
    }
  })

  it('infers renames in linear time when no new block shows a signal', () => {
    expectLinearGrowth((n) => renameAll(n, {}), 16)
  })

  it('infers renames in linear time when every new block pairs by its references', () => {
    expectLinearGrowth((n) => renameAll(n, { renameReaders: true }), 16)
  })

  it('infers renames in linear time when every pair shares its one neighbour', () => {
    expectLinearGrowth((n) => renameAll(n, { hub: true }), 16)
  })
})

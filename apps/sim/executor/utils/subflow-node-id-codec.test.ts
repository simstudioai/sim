/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { SubflowNodeIdCodec } from '@/executor/utils/subflow-node-id-codec'

describe('SubflowNodeIdCodec', () => {
  describe('branch subscripts', () => {
    it('builds and round-trips branch node IDs', () => {
      const id = SubflowNodeIdCodec.buildBranchNodeId('block-1', 2)
      expect(id).toBe('block-1₍2₎')
      expect(SubflowNodeIdCodec.isBranchNodeId(id)).toBe(true)
      expect(SubflowNodeIdCodec.extractBaseBlockId(id)).toBe('block-1')
      expect(SubflowNodeIdCodec.extractBranchIndex(id)).toBe(2)
    })

    it('returns null index and false predicate for non-branch IDs', () => {
      expect(SubflowNodeIdCodec.isBranchNodeId('block-1')).toBe(false)
      expect(SubflowNodeIdCodec.extractBranchIndex('block-1')).toBeNull()
      expect(SubflowNodeIdCodec.extractBaseBlockId('block-1')).toBe('block-1')
    })

    it('only strips a trailing branch subscript', () => {
      expect(SubflowNodeIdCodec.extractBaseBlockId('a₍1₎b')).toBe('a₍1₎b')
      expect(SubflowNodeIdCodec.extractBaseBlockId('a₍1₎b₍2₎')).toBe('a₍1₎b')
    })
  })

  describe('loop sentinels', () => {
    it('builds and parses loop sentinel IDs', () => {
      const start = SubflowNodeIdCodec.buildLoopSentinelStartId('loop-1')
      const end = SubflowNodeIdCodec.buildLoopSentinelEndId('loop-1')
      expect(start).toBe('loop-loop-1-sentinel-start')
      expect(end).toBe('loop-loop-1-sentinel-end')
      expect(SubflowNodeIdCodec.isLoopSentinelNodeId(start)).toBe(true)
      expect(SubflowNodeIdCodec.isLoopSentinelNodeId(end)).toBe(true)
      expect(SubflowNodeIdCodec.extractLoopIdFromSentinel(start)).toBe('loop-1')
      expect(SubflowNodeIdCodec.extractLoopIdFromSentinel(end)).toBe('loop-1')
    })

    it('returns null when not a loop sentinel', () => {
      expect(SubflowNodeIdCodec.isLoopSentinelNodeId('block-1')).toBe(false)
      expect(SubflowNodeIdCodec.extractLoopIdFromSentinel('block-1')).toBeNull()
    })
  })

  describe('parallel sentinels', () => {
    it('builds and parses parallel sentinel IDs', () => {
      const start = SubflowNodeIdCodec.buildParallelSentinelStartId('p-1')
      const end = SubflowNodeIdCodec.buildParallelSentinelEndId('p-1')
      expect(start).toBe('parallel-p-1-sentinel-start')
      expect(end).toBe('parallel-p-1-sentinel-end')
      expect(SubflowNodeIdCodec.isParallelSentinelNodeId(start)).toBe(true)
      expect(SubflowNodeIdCodec.isParallelSentinelNodeId(end)).toBe(true)
      expect(SubflowNodeIdCodec.extractParallelIdFromSentinel(start)).toBe('p-1')
      expect(SubflowNodeIdCodec.extractParallelIdFromSentinel(end)).toBe('p-1')
    })

    it('returns null when not a parallel sentinel', () => {
      expect(SubflowNodeIdCodec.isParallelSentinelNodeId('block-1')).toBe(false)
      expect(SubflowNodeIdCodec.extractParallelIdFromSentinel('block-1')).toBeNull()
    })
  })

  describe('outer-branch clone scoping', () => {
    it('builds and extracts outer branch index', () => {
      const id = SubflowNodeIdCodec.buildOuterBranchScopedId('loop-1', 3)
      expect(id).toBe('loop-1__obranch-3')
      expect(SubflowNodeIdCodec.extractOuterBranchIndex(id)).toBe(3)
    })

    it('extracts the innermost outer branch index for nested clones', () => {
      const id = 'loop-1__obranch-2__obranch-5'
      expect(SubflowNodeIdCodec.extractOuterBranchIndex(id)).toBe(2)
      expect(SubflowNodeIdCodec.extractInnermostOuterBranchIndex(id)).toBe(5)
    })

    it('returns undefined when no outer branch suffix is present', () => {
      expect(SubflowNodeIdCodec.extractOuterBranchIndex('loop-1')).toBeUndefined()
      expect(SubflowNodeIdCodec.extractInnermostOuterBranchIndex('loop-1')).toBeUndefined()
    })

    it('strips outer-branch and clone-digest suffixes', () => {
      expect(SubflowNodeIdCodec.stripOuterBranchSuffix('loop-1__obranch-2')).toBe('loop-1')
      expect(SubflowNodeIdCodec.stripOuterBranchSuffix('loop-1__cloneABCDEF__obranch-2')).toBe(
        'loop-1'
      )
    })

    it('strips all clone suffixes and branch subscripts to the base block ID', () => {
      expect(SubflowNodeIdCodec.stripCloneSuffixes('block-1__obranch-2₍3₎')).toBe('block-1')
      expect(SubflowNodeIdCodec.stripCloneSuffixes('block-1__clone0a1f__obranch-2₍0₎')).toBe(
        'block-1'
      )
    })
  })

  describe('normalizeNodeId', () => {
    it('normalizes branch, loop sentinel, and parallel sentinel IDs', () => {
      expect(SubflowNodeIdCodec.normalizeNodeId('block-1₍2₎')).toBe('block-1')
      expect(SubflowNodeIdCodec.normalizeNodeId('loop-loop-1-sentinel-start')).toBe('loop-1')
      expect(SubflowNodeIdCodec.normalizeNodeId('parallel-p-1-sentinel-end')).toBe('p-1')
      expect(SubflowNodeIdCodec.normalizeNodeId('block-1')).toBe('block-1')
    })
  })

  describe('loop digest lookup helpers', () => {
    it('strips branch subscripts and loop digests for lookup keys', () => {
      expect(SubflowNodeIdCodec.normalizeLookupId('block-1₍2₎_loop3')).toBe('block-1')
      expect(SubflowNodeIdCodec.normalizeLookupId('block-1')).toBe('block-1')
    })

    it('extracts the leading branch suffix and loop digest segments', () => {
      expect(SubflowNodeIdCodec.extractBranchSuffix('block-1₍2₎_loop3')).toBe('₍2₎')
      expect(SubflowNodeIdCodec.extractBranchSuffix('block-1')).toBe('')
      expect(SubflowNodeIdCodec.extractLoopSuffix('block-1₍2₎_loop3')).toBe('_loop3')
      expect(SubflowNodeIdCodec.extractLoopSuffix('block-1')).toBe('')
    })
  })

  describe('findEffectiveContainerId', () => {
    it('returns the original ID for branch 0 / missing scope', () => {
      const map = new Map<string, unknown>([['loop-1', {}]])
      expect(SubflowNodeIdCodec.findEffectiveContainerId('loop-1', 'block-1', map)).toBe('loop-1')
    })

    it('prefers the mapped cloned scope when present', () => {
      const map = new Map<string, unknown>([
        ['loop-1', {}],
        ['loop-1__obranch-2', {}],
      ])
      expect(SubflowNodeIdCodec.findEffectiveContainerId('loop-1', 'block-1', map, 2)).toBe(
        'loop-1__obranch-2'
      )
    })

    it('resolves the cloned scope from the current node ID suffix', () => {
      const map = new Map<string, unknown>([
        ['loop-1', {}],
        ['loop-1__obranch-3', {}],
      ])
      expect(SubflowNodeIdCodec.findEffectiveContainerId('loop-1', 'block-1__obranch-3', map)).toBe(
        'loop-1__obranch-3'
      )
    })

    it('prefers __clone scopes when the current node carries a clone marker', () => {
      const map = new Map<string, unknown>([
        ['loop-1__obranch-2', {}],
        ['loop-1__cloneabc__obranch-2', {}],
      ])
      expect(
        SubflowNodeIdCodec.findEffectiveContainerId('loop-1', 'block-1__cloneabc__obranch-2', map)
      ).toBe('loop-1__cloneabc__obranch-2')
    })
  })

  describe('round-trip parse ∘ build', () => {
    it('builds then parses branch IDs symmetrically', () => {
      for (const index of [0, 1, 7, 20]) {
        const id = SubflowNodeIdCodec.buildBranchNodeId('base-id', index)
        expect(SubflowNodeIdCodec.extractBranchIndex(id)).toBe(index)
        expect(SubflowNodeIdCodec.extractBaseBlockId(id)).toBe('base-id')
      }
    })

    it('builds then parses outer-branch scoped IDs symmetrically', () => {
      for (const index of [1, 4, 19]) {
        const id = SubflowNodeIdCodec.buildOuterBranchScopedId('base-id', index)
        expect(SubflowNodeIdCodec.extractOuterBranchIndex(id)).toBe(index)
        expect(SubflowNodeIdCodec.stripOuterBranchSuffix(id)).toBe('base-id')
      }
    })
  })
})

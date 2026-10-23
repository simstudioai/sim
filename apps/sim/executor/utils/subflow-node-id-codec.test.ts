import { describe, expect, it } from 'vitest'
import {
  buildBranchNodeId,
  buildLoopSentinelEndId,
  buildLoopSentinelStartId,
  buildOuterBranchScopedId,
  buildParallelSentinelEndId,
  buildParallelSentinelStartId,
  extractBaseBlockId,
  extractBranchIndex,
  extractBranchSuffix,
  extractInnermostOuterBranchIndex,
  extractLoopIdFromSentinel,
  extractLoopSuffix,
  extractOuterBranchIndex,
  extractParallelIdFromSentinel,
  findEffectiveContainerId,
  isBranchNodeId,
  isLoopSentinelNodeId,
  isParallelSentinelNodeId,
  normalizeLookupId,
  normalizeNodeId,
  stripCloneSuffixes,
  stripOuterBranchSuffix,
} from '@/executor/utils/subflow-node-id-codec'

describe('subflow node id codec', () => {
  describe('branch subscripts', () => {
    it('builds and round-trips branch node IDs', () => {
      const id = buildBranchNodeId('block-1', 2)
      expect(id).toBe('block-1₍2₎')
      expect(isBranchNodeId(id)).toBe(true)
      expect(extractBaseBlockId(id)).toBe('block-1')
      expect(extractBranchIndex(id)).toBe(2)
    })

    it('only strips a trailing branch subscript', () => {
      expect(extractBaseBlockId('a₍1₎b')).toBe('a₍1₎b')
      expect(extractBaseBlockId('a₍1₎b₍2₎')).toBe('a₍1₎b')
    })
  })

  describe('loop sentinels', () => {
    it('builds and parses loop sentinel IDs', () => {
      const start = buildLoopSentinelStartId('loop-1')
      const end = buildLoopSentinelEndId('loop-1')
      expect(start).toBe('loop-loop-1-sentinel-start')
      expect(end).toBe('loop-loop-1-sentinel-end')
      expect(isLoopSentinelNodeId(start)).toBe(true)
      expect(isLoopSentinelNodeId(end)).toBe(true)
      expect(extractLoopIdFromSentinel(start)).toBe('loop-1')
      expect(extractLoopIdFromSentinel(end)).toBe('loop-1')
    })
  })

  describe('parallel sentinels', () => {
    it('builds and parses parallel sentinel IDs', () => {
      const start = buildParallelSentinelStartId('p-1')
      const end = buildParallelSentinelEndId('p-1')
      expect(start).toBe('parallel-p-1-sentinel-start')
      expect(end).toBe('parallel-p-1-sentinel-end')
      expect(isParallelSentinelNodeId(start)).toBe(true)
      expect(isParallelSentinelNodeId(end)).toBe(true)
      expect(extractParallelIdFromSentinel(start)).toBe('p-1')
      expect(extractParallelIdFromSentinel(end)).toBe('p-1')
    })
  })

  describe('outer-branch clone scoping', () => {
    it('builds and extracts outer branch index', () => {
      const id = buildOuterBranchScopedId('loop-1', 3)
      expect(id).toBe('loop-1__obranch-3')
      expect(extractOuterBranchIndex(id)).toBe(3)
    })

    it('extracts the innermost outer branch index for nested clones', () => {
      const id = 'loop-1__obranch-2__obranch-5'
      expect(extractOuterBranchIndex(id)).toBe(2)
      expect(extractInnermostOuterBranchIndex(id)).toBe(5)
    })

    it('strips outer-branch and clone-digest suffixes', () => {
      expect(stripOuterBranchSuffix('loop-1__obranch-2')).toBe('loop-1')
      expect(stripOuterBranchSuffix('loop-1__cloneABCDEF__obranch-2')).toBe('loop-1')
    })

    it('strips all clone suffixes and branch subscripts to the base block ID', () => {
      expect(stripCloneSuffixes('block-1__obranch-2₍3₎')).toBe('block-1')
      expect(stripCloneSuffixes('block-1__clone0a1f__obranch-2₍0₎')).toBe('block-1')
    })
  })

  describe('normalizeNodeId', () => {
    it('normalizes branch, loop sentinel, and parallel sentinel IDs', () => {
      expect(normalizeNodeId('block-1₍2₎')).toBe('block-1')
      expect(normalizeNodeId('loop-loop-1-sentinel-start')).toBe('loop-1')
      expect(normalizeNodeId('parallel-p-1-sentinel-end')).toBe('p-1')
      expect(normalizeNodeId('block-1')).toBe('block-1')
    })
  })

  describe('loop digest lookup helpers', () => {
    it('strips branch subscripts and loop digests for lookup keys', () => {
      expect(normalizeLookupId('block-1₍2₎_loop3')).toBe('block-1')
      expect(normalizeLookupId('block-1')).toBe('block-1')
    })

    it('extracts the leading branch suffix and loop digest segments', () => {
      expect(extractBranchSuffix('block-1₍2₎_loop3')).toBe('₍2₎')
      expect(extractBranchSuffix('block-1')).toBe('')
      expect(extractLoopSuffix('block-1₍2₎_loop3')).toBe('_loop3')
      expect(extractLoopSuffix('block-1')).toBe('')
    })
  })

  describe('findEffectiveContainerId', () => {
    it('prefers the mapped cloned scope when present', () => {
      const map = new Map<string, unknown>([
        ['loop-1', {}],
        ['loop-1__obranch-2', {}],
      ])
      expect(findEffectiveContainerId('loop-1', 'block-1', map, 2)).toBe('loop-1__obranch-2')
    })

    it('resolves the cloned scope from the current node ID suffix', () => {
      const map = new Map<string, unknown>([
        ['loop-1', {}],
        ['loop-1__obranch-3', {}],
      ])
      expect(findEffectiveContainerId('loop-1', 'block-1__obranch-3', map)).toBe(
        'loop-1__obranch-3'
      )
    })

    it('prefers __clone scopes when the current node carries a clone marker', () => {
      const map = new Map<string, unknown>([
        ['loop-1__obranch-2', {}],
        ['loop-1__cloneabc__obranch-2', {}],
      ])
      expect(findEffectiveContainerId('loop-1', 'block-1__cloneabc__obranch-2', map)).toBe(
        'loop-1__cloneabc__obranch-2'
      )
    })
  })
})

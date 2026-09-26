import { describe, expect, it } from 'vitest'
import {
  buildNextCallChain,
  MAX_CALL_CHAIN_DEPTH,
  parseCallChain,
  validateCallChain,
} from '@/lib/execution/call-chain'

describe('call-chain', () => {
  describe('parseCallChain', () => {
    it('returns empty array for null', () => {
      expect(parseCallChain(null)).toEqual([])
    })

    it('parses a single workflow ID', () => {
      expect(parseCallChain('wf-abc')).toEqual(['wf-abc'])
    })

    it('parses multiple comma-separated workflow IDs', () => {
      expect(parseCallChain('wf-a,wf-b,wf-c')).toEqual(['wf-a', 'wf-b', 'wf-c'])
    })

    it('trims whitespace around workflow IDs', () => {
      expect(parseCallChain(' wf-a , wf-b , wf-c ')).toEqual(['wf-a', 'wf-b', 'wf-c'])
    })

    it('filters out empty segments', () => {
      expect(parseCallChain('wf-a,,wf-b')).toEqual(['wf-a', 'wf-b'])
    })
  })

  describe('validateCallChain', () => {
    it('returns null for an empty chain', () => {
      expect(validateCallChain([])).toBeNull()
    })

    it('returns null when chain is under max depth', () => {
      expect(validateCallChain(['wf-a', 'wf-b'])).toBeNull()
    })

    it('allows legitimate self-recursion', () => {
      expect(validateCallChain(['wf-a', 'wf-a', 'wf-a'])).toBeNull()
    })

    it('returns depth error when chain is at max depth', () => {
      const chain = Array.from({ length: MAX_CALL_CHAIN_DEPTH }, (_, i) => `wf-${i}`)
      const error = validateCallChain(chain)
      expect(error).toContain(
        `Maximum workflow call chain depth (${MAX_CALL_CHAIN_DEPTH}) exceeded`
      )
    })

    it('allows chain just under max depth', () => {
      const chain = Array.from({ length: MAX_CALL_CHAIN_DEPTH - 1 }, (_, i) => `wf-${i}`)
      expect(validateCallChain(chain)).toBeNull()
    })
  })

  describe('buildNextCallChain', () => {
    it('does not mutate the original chain', () => {
      const original = ['wf-a']
      const result = buildNextCallChain(original, 'wf-b')
      expect(original).toEqual(['wf-a'])
      expect(result).toEqual(['wf-a', 'wf-b'])
    })
  })
})

/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  buildNextCallChain,
  MAX_CALL_CHAIN_DEPTH,
  parseCallChain,
  SIM_VIA_HEADER,
  serializeCallChain,
  validateCallChain,
} from '@/lib/execution/call-chain'

describe('call-chain', () => {
  describe('SIM_VIA_HEADER', () => {
    it('has the expected header name', () => {
      expect(SIM_VIA_HEADER).toBe('X-Sim-Via')
    })
  })

  describe('MAX_CALL_CHAIN_DEPTH', () => {
    it('equals 10', () => {
      expect(MAX_CALL_CHAIN_DEPTH).toBe(10)
    })
  })

  describe('parseCallChain', () => {
    it('returns empty array for null', () => {
      expect(parseCallChain(null)).toEqual([])
    })

    it('returns empty array for undefined', () => {
      expect(parseCallChain(undefined)).toEqual([])
    })

    it('returns empty array for empty string', () => {
      expect(parseCallChain('')).toEqual([])
    })

    it('returns empty array for whitespace-only string', () => {
      expect(parseCallChain('   ')).toEqual([])
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

  describe('serializeCallChain', () => {
    it('serializes an empty array', () => {
      expect(serializeCallChain([])).toBe('')
    })

    it('serializes a single ID', () => {
      expect(serializeCallChain(['wf-a'])).toBe('wf-a')
    })

    it('serializes multiple IDs with commas', () => {
      expect(serializeCallChain(['wf-a', 'wf-b', 'wf-c'])).toBe('wf-a,wf-b,wf-c')
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
    it('appends workflow ID to empty chain', () => {
      expect(buildNextCallChain([], 'wf-a')).toEqual(['wf-a'])
    })

    it('appends workflow ID to existing chain', () => {
      expect(buildNextCallChain(['wf-a', 'wf-b'], 'wf-c')).toEqual(['wf-a', 'wf-b', 'wf-c'])
    })

    it('does not mutate the original chain', () => {
      const original = ['wf-a']
      const result = buildNextCallChain(original, 'wf-b')
      expect(original).toEqual(['wf-a'])
      expect(result).toEqual(['wf-a', 'wf-b'])
    })
  })

  describe('round-trip', () => {
    it('parse → serialize is identity', () => {
      const header = 'wf-a,wf-b,wf-c'
      expect(serializeCallChain(parseCallChain(header))).toBe(header)
    })

    it('serialize → parse is identity', () => {
      const chain = ['wf-a', 'wf-b', 'wf-c']
      expect(parseCallChain(serializeCallChain(chain))).toEqual(chain)
    })
  })
})

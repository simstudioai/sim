import { describe, expect, it } from 'vitest'
import {
  type BlockReferenceContext,
  InvalidFieldError,
  resolveBlockReference,
} from './block-reference'

describe('resolveBlockReference', () => {
  const createContext = (
    overrides: Partial<BlockReferenceContext> = {}
  ): BlockReferenceContext => ({
    blockNameMapping: { start: 'block-1', agent: 'block-2' },
    blockData: {},
    blockOutputSchemas: {},
    ...overrides,
  })

  describe('block name resolution', () => {
    it('should normalize block name before lookup', () => {
      const ctx = createContext({
        blockNameMapping: { myblock: 'block-1' },
        blockData: { 'block-1': { value: 'test' } },
      })

      const result = resolveBlockReference('MyBlock', ['value'], ctx)
      expect(result).toEqual({ value: 'test', blockId: 'block-1' })
    })
  })

  describe('field resolution', () => {
    it('should resolve array index path', () => {
      const ctx = createContext({
        blockData: { 'block-1': { items: ['a', 'b', 'c'] } },
      })

      const result = resolveBlockReference('start', ['items', '1'], ctx)
      expect(result).toEqual({ value: 'b', blockId: 'block-1' })
    })

    it('should return undefined value when field exists but has no value', () => {
      const ctx = createContext({
        blockData: { 'block-1': { input: undefined } },
        blockOutputSchemas: {
          'block-1': { input: { type: 'string' } },
        },
      })

      const result = resolveBlockReference('start', ['input'], ctx)
      expect(result).toEqual({ value: undefined, blockId: 'block-1' })
    })
  })

  describe('schema validation', () => {
    it('should throw InvalidFieldError when field not in schema', () => {
      const ctx = createContext({
        blockData: { 'block-1': { existing: 'value' } },
        blockOutputSchemas: {
          'block-1': {
            input: { type: 'string' },
            conversationId: { type: 'string' },
          },
        },
      })

      expect(() => resolveBlockReference('start', ['invalid'], ctx)).toThrow(InvalidFieldError)
      expect(() => resolveBlockReference('start', ['invalid'], ctx)).toThrow(
        /"invalid" doesn't exist on block "start"/
      )
    })

    it('should include available fields in error message', () => {
      const ctx = createContext({
        blockData: { 'block-1': {} },
        blockOutputSchemas: {
          'block-1': {
            input: { type: 'string' },
            conversationId: { type: 'string' },
            files: { type: 'file[]' },
          },
        },
      })

      try {
        resolveBlockReference('start', ['typo'], ctx)
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidFieldError)
        const fieldError = error as InvalidFieldError
        expect(fieldError.availableFields).toContain('input')
        expect(fieldError.availableFields).toContain('conversationId')
        expect(fieldError.availableFields).toContain('files')
      }
    })

    it('should not validate path when block has no output yet', () => {
      // Blocks with no output typically live on a branched path that wasn't
      // taken this run. We resolve such references to undefined (which the
      // caller maps to RESOLVED_EMPTY) rather than throwing on every nested
      // path the schema doesn't pre-declare.
      const ctx = createContext({
        blockData: {},
        blockOutputSchemas: {
          'block-1': { input: { type: 'string' } },
        },
      })

      const result = resolveBlockReference('start', ['invalid'], ctx)
      expect(result).toEqual({ value: undefined, blockId: 'block-1' })
    })

    it('should return undefined for nested path under json field when block has no output', () => {
      // Repro for the branched-path bug: a function block with a dynamic
      // `json` result that never ran should resolve to undefined regardless
      // of the nested path, not throw.
      const ctx = createContext({
        blockData: {},
        blockOutputSchemas: {
          'block-1': {
            result: { type: 'json' },
            stdout: { type: 'string' },
          },
        },
      })

      const result = resolveBlockReference('start', ['result', 'summary'], ctx)
      expect(result).toEqual({ value: undefined, blockId: 'block-1' })
    })

    it('should not throw for nested path under json field on executed block', () => {
      // A `json` field declares dynamic shape, so drilling into it must be
      // permitted even when the runtime data doesn't happen to include that
      // key on this run.
      const ctx = createContext({
        blockData: { 'block-1': { result: { foo: 1 } } },
        blockOutputSchemas: {
          'block-1': {
            result: { type: 'json' },
            stdout: { type: 'string' },
          },
        },
      })

      const result = resolveBlockReference('start', ['result', 'summary'], ctx)
      expect(result).toEqual({ value: undefined, blockId: 'block-1' })
    })

    it('should resolve values nested under json field on executed block', () => {
      const ctx = createContext({
        blockData: { 'block-1': { result: { summary: 'hello' } } },
        blockOutputSchemas: {
          'block-1': {
            result: { type: 'json' },
            stdout: { type: 'string' },
          },
        },
      })

      const result = resolveBlockReference('start', ['result', 'summary'], ctx)
      expect(result).toEqual({ value: 'hello', blockId: 'block-1' })
    })
  })

  describe('file type handling', () => {
    it('should validate file property names', () => {
      const ctx = createContext({
        blockData: { 'block-1': { files: [] } },
        blockOutputSchemas: {
          'block-1': { files: { type: 'file[]' } },
        },
      })

      expect(() => resolveBlockReference('start', ['files', '0', 'invalid'], ctx)).toThrow(
        InvalidFieldError
      )
    })
  })
})

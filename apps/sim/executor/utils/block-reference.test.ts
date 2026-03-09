/**
 * @vitest-environment node
 */
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
    it('should return undefined when block name does not exist', () => {
      const ctx = createContext()
      const result = resolveBlockReference('unknown', ['field'], ctx)
      expect(result).toBeUndefined()
    })

    it('should normalize block name before lookup', () => {
      const ctx = createContext({
        blockNameMapping: { myblock: 'block-1' },
        blockData: { 'block-1': { value: 'test' } },
      })

      const result = resolveBlockReference('MyBlock', ['value'], ctx)
      expect(result).toEqual({ value: 'test', blockId: 'block-1' })
    })

    it('should handle block names with spaces', () => {
      const ctx = createContext({
        blockNameMapping: { myblock: 'block-1' },
        blockData: { 'block-1': { value: 'test' } },
      })

      const result = resolveBlockReference('My Block', ['value'], ctx)
      expect(result).toEqual({ value: 'test', blockId: 'block-1' })
    })
  })

  describe('field resolution', () => {
    it('should return entire block output when no path specified', () => {
      const ctx = createContext({
        blockData: { 'block-1': { input: 'hello', other: 'data' } },
      })

      const result = resolveBlockReference('start', [], ctx)
      expect(result).toEqual({
        value: { input: 'hello', other: 'data' },
        blockId: 'block-1',
      })
    })

    it('should resolve simple field path', () => {
      const ctx = createContext({
        blockData: { 'block-1': { input: 'hello' } },
      })

      const result = resolveBlockReference('start', ['input'], ctx)
      expect(result).toEqual({ value: 'hello', blockId: 'block-1' })
    })

    it('should resolve nested field path', () => {
      const ctx = createContext({
        blockData: { 'block-1': { response: { data: { name: 'test' } } } },
      })

      const result = resolveBlockReference('start', ['response', 'data', 'name'], ctx)
      expect(result).toEqual({ value: 'test', blockId: 'block-1' })
    })

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

    it('should return null value when field has null', () => {
      const ctx = createContext({
        blockData: { 'block-1': { input: null } },
      })

      const result = resolveBlockReference('start', ['input'], ctx)
      expect(result).toEqual({ value: null, blockId: 'block-1' })
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

    it('should allow valid field even when value is undefined', () => {
      const ctx = createContext({
        blockData: { 'block-1': {} },
        blockOutputSchemas: {
          'block-1': { input: { type: 'string' } },
        },
      })

      const result = resolveBlockReference('start', ['input'], ctx)
      expect(result).toEqual({ value: undefined, blockId: 'block-1' })
    })

    it('should validate path when block has no output yet', () => {
      const ctx = createContext({
        blockData: {},
        blockOutputSchemas: {
          'block-1': { input: { type: 'string' } },
        },
      })

      expect(() => resolveBlockReference('start', ['invalid'], ctx)).toThrow(InvalidFieldError)
    })

    it('should return undefined for valid field when block has no output', () => {
      const ctx = createContext({
        blockData: {},
        blockOutputSchemas: {
          'block-1': { input: { type: 'string' } },
        },
      })

      const result = resolveBlockReference('start', ['input'], ctx)
      expect(result).toEqual({ value: undefined, blockId: 'block-1' })
    })
  })

  describe('without schema (pass-through mode)', () => {
    it('should return undefined value without throwing when no schema', () => {
      const ctx = createContext({
        blockData: { 'block-1': { existing: 'value' } },
      })

      const result = resolveBlockReference('start', ['missing'], ctx)
      expect(result).toEqual({ value: undefined, blockId: 'block-1' })
    })
  })

  describe('file type handling', () => {
    it('should allow file property access', () => {
      const ctx = createContext({
        blockData: {
          'block-1': {
            files: [{ name: 'test.txt', url: 'http://example.com/file' }],
          },
        },
        blockOutputSchemas: {
          'block-1': { files: { type: 'file[]' } },
        },
      })

      const result = resolveBlockReference('start', ['files', '0', 'name'], ctx)
      expect(result).toEqual({ value: 'test.txt', blockId: 'block-1' })
    })

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

describe('InvalidFieldError', () => {
  it('should have correct properties', () => {
    const error = new InvalidFieldError('myBlock', 'invalid.path', ['field1', 'field2'])

    expect(error.blockName).toBe('myBlock')
    expect(error.fieldPath).toBe('invalid.path')
    expect(error.availableFields).toEqual(['field1', 'field2'])
    expect(error.name).toBe('InvalidFieldError')
  })

  it('should format message correctly', () => {
    const error = new InvalidFieldError('start', 'typo', ['input', 'files'])

    expect(error.message).toBe(
      '"typo" doesn\'t exist on block "start". Available fields: input, files'
    )
  })

  it('should handle empty available fields', () => {
    const error = new InvalidFieldError('start', 'field', [])

    expect(error.message).toBe('"field" doesn\'t exist on block "start". Available fields: none')
  })
})

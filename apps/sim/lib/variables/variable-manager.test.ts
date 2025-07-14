import { describe, expect, it } from 'vitest'
import { VariableManager } from '@/lib/variables/variable-manager'

describe('VariableManager', () => {
  describe('parseInputForStorage', () => {
    it.concurrent('should handle plain type variables', () => {
      expect(VariableManager.parseInputForStorage('hello world', 'plain')).toBe('hello world')
      expect(VariableManager.parseInputForStorage('123', 'plain')).toBe('123')
      expect(VariableManager.parseInputForStorage('true', 'plain')).toBe('true')
      expect(VariableManager.parseInputForStorage('{"foo":"bar"}', 'plain')).toBe('{"foo":"bar"}')
    })

    it.concurrent('should handle string type variables', () => {
      expect(VariableManager.parseInputForStorage('hello world', 'string')).toBe('hello world')
      expect(VariableManager.parseInputForStorage('"hello world"', 'string')).toBe('hello world')
      expect(VariableManager.parseInputForStorage("'hello world'", 'string')).toBe('hello world')
    })

    it.concurrent('should handle number type variables', () => {
      expect(VariableManager.parseInputForStorage('42', 'number')).toBe(42)
      expect(VariableManager.parseInputForStorage('-3.14', 'number')).toBe(-3.14)
      expect(VariableManager.parseInputForStorage('"42"', 'number')).toBe(42)
      expect(VariableManager.parseInputForStorage('not a number', 'number')).toBe(0)
    })

    it.concurrent('should handle boolean type variables', () => {
      expect(VariableManager.parseInputForStorage('true', 'boolean')).toBe(true)
      expect(VariableManager.parseInputForStorage('false', 'boolean')).toBe(false)
      expect(VariableManager.parseInputForStorage('1', 'boolean')).toBe(true)
      expect(VariableManager.parseInputForStorage('0', 'boolean')).toBe(false)
      expect(VariableManager.parseInputForStorage('"true"', 'boolean')).toBe(true)
      expect(VariableManager.parseInputForStorage("'false'", 'boolean')).toBe(false)
    })

    it.concurrent('should handle object type variables', () => {
      expect(VariableManager.parseInputForStorage('{"foo":"bar"}', 'object')).toEqual({
        foo: 'bar',
      })
      expect(VariableManager.parseInputForStorage('invalid json', 'object')).toEqual({})
      expect(VariableManager.parseInputForStorage('42', 'object')).toEqual({ value: '42' })
    })

    it.concurrent('should handle array type variables', () => {
      expect(VariableManager.parseInputForStorage('[1,2,3]', 'array')).toEqual([1, 2, 3])
      expect(VariableManager.parseInputForStorage('invalid json', 'array')).toEqual([])
      expect(VariableManager.parseInputForStorage('42', 'array')).toEqual(['42'])
    })

    it.concurrent('should handle empty values', () => {
      expect(VariableManager.parseInputForStorage('', 'string')).toBe('')
      expect(VariableManager.parseInputForStorage('', 'number')).toBe('')
      expect(VariableManager.parseInputForStorage(null as any, 'boolean')).toBe('')
      expect(VariableManager.parseInputForStorage(undefined as any, 'object')).toBe('')
    })
  })

  describe('formatForEditor', () => {
    it.concurrent('should format plain type variables for editor', () => {
      expect(VariableManager.formatForEditor('hello world', 'plain')).toBe('hello world')
      expect(VariableManager.formatForEditor(42, 'plain')).toBe('42')
      expect(VariableManager.formatForEditor(true, 'plain')).toBe('true')
    })

    it.concurrent('should format string type variables for editor', () => {
      expect(VariableManager.formatForEditor('hello world', 'string')).toBe('hello world')
      expect(VariableManager.formatForEditor(42, 'string')).toBe('42')
      expect(VariableManager.formatForEditor(true, 'string')).toBe('true')
    })

    it.concurrent('should format number type variables for editor', () => {
      expect(VariableManager.formatForEditor(42, 'number')).toBe('42')
      expect(VariableManager.formatForEditor('42', 'number')).toBe('42')
      expect(VariableManager.formatForEditor('not a number', 'number')).toBe('0')
    })

    it.concurrent('should format boolean type variables for editor', () => {
      expect(VariableManager.formatForEditor(true, 'boolean')).toBe('true')
      expect(VariableManager.formatForEditor(false, 'boolean')).toBe('false')
      expect(VariableManager.formatForEditor('true', 'boolean')).toBe('true')
      expect(VariableManager.formatForEditor('anything else', 'boolean')).toBe('true')
    })

    it.concurrent('should format object type variables for editor', () => {
      expect(VariableManager.formatForEditor({ foo: 'bar' }, 'object')).toBe('{\n  "foo": "bar"\n}')
      expect(VariableManager.formatForEditor('{"foo":"bar"}', 'object')).toBe(
        '{\n  "foo": "bar"\n}'
      )
      expect(VariableManager.formatForEditor('invalid json', 'object')).toEqual(
        '{\n  "value": "invalid json"\n}'
      )
    })

    it.concurrent('should format array type variables for editor', () => {
      expect(VariableManager.formatForEditor([1, 2, 3], 'array')).toBe('[\n  1,\n  2,\n  3\n]')
      expect(VariableManager.formatForEditor('[1,2,3]', 'array')).toBe('[\n  1,\n  2,\n  3\n]')
      expect(VariableManager.formatForEditor('invalid json', 'array')).toEqual(
        '[\n  "invalid json"\n]'
      )
    })

    it.concurrent('should handle empty values', () => {
      expect(VariableManager.formatForEditor(null, 'string')).toBe('')
      expect(VariableManager.formatForEditor(undefined, 'number')).toBe('')
    })
  })

  describe('resolveForExecution', () => {
    it.concurrent('should resolve plain type variables for execution', () => {
      expect(VariableManager.resolveForExecution('hello world', 'plain')).toBe('hello world')
      expect(VariableManager.resolveForExecution(42, 'plain')).toBe('42')
      expect(VariableManager.resolveForExecution(true, 'plain')).toBe('true')
    })

    it.concurrent('should resolve string type variables for execution', () => {
      expect(VariableManager.resolveForExecution('hello world', 'string')).toBe('hello world')
      expect(VariableManager.resolveForExecution(42, 'string')).toBe('42')
      expect(VariableManager.resolveForExecution(true, 'string')).toBe('true')
    })

    it.concurrent('should resolve number type variables for execution', () => {
      expect(VariableManager.resolveForExecution(42, 'number')).toBe(42)
      expect(VariableManager.resolveForExecution('42', 'number')).toBe(42)
      expect(VariableManager.resolveForExecution('not a number', 'number')).toBe(0)
    })

    it.concurrent('should resolve boolean type variables for execution', () => {
      expect(VariableManager.resolveForExecution(true, 'boolean')).toBe(true)
      expect(VariableManager.resolveForExecution(false, 'boolean')).toBe(false)
      expect(VariableManager.resolveForExecution('true', 'boolean')).toBe(true)
      expect(VariableManager.resolveForExecution('false', 'boolean')).toBe(false)
      expect(VariableManager.resolveForExecution('1', 'boolean')).toBe(true)
      expect(VariableManager.resolveForExecution('0', 'boolean')).toBe(false)
    })

    it.concurrent('should resolve object type variables for execution', () => {
      expect(VariableManager.resolveForExecution({ foo: 'bar' }, 'object')).toEqual({ foo: 'bar' })
      expect(VariableManager.resolveForExecution('{"foo":"bar"}', 'object')).toEqual({ foo: 'bar' })
      expect(VariableManager.resolveForExecution('invalid json', 'object')).toEqual({})
    })

    it.concurrent('should resolve array type variables for execution', () => {
      expect(VariableManager.resolveForExecution([1, 2, 3], 'array')).toEqual([1, 2, 3])
      expect(VariableManager.resolveForExecution('[1,2,3]', 'array')).toEqual([1, 2, 3])
      expect(VariableManager.resolveForExecution('invalid json', 'array')).toEqual([])
    })

    it.concurrent('should handle null and undefined', () => {
      expect(VariableManager.resolveForExecution(null, 'string')).toBe(null)
      expect(VariableManager.resolveForExecution(undefined, 'number')).toBe(undefined)
    })
  })

  describe('formatForTemplateInterpolation', () => {
    it.concurrent('should format plain type variables for interpolation', () => {
      expect(VariableManager.formatForTemplateInterpolation('hello world', 'plain')).toBe(
        'hello world'
      )
      expect(VariableManager.formatForTemplateInterpolation(42, 'plain')).toBe('42')
      expect(VariableManager.formatForTemplateInterpolation(true, 'plain')).toBe('true')
    })

    it.concurrent('should format string type variables for interpolation', () => {
      expect(VariableManager.formatForTemplateInterpolation('hello world', 'string')).toBe(
        'hello world'
      )
      expect(VariableManager.formatForTemplateInterpolation(42, 'string')).toBe('42')
      expect(VariableManager.formatForTemplateInterpolation(true, 'string')).toBe('true')
    })

    it.concurrent('should format object type variables for interpolation', () => {
      expect(VariableManager.formatForTemplateInterpolation({ foo: 'bar' }, 'object')).toBe(
        '{"foo":"bar"}'
      )
      expect(VariableManager.formatForTemplateInterpolation('{"foo":"bar"}', 'object')).toBe(
        '{"foo":"bar"}'
      )
    })

    it.concurrent('should handle empty values', () => {
      expect(VariableManager.formatForTemplateInterpolation(null, 'string')).toBe('')
      expect(VariableManager.formatForTemplateInterpolation(undefined, 'number')).toBe('')
    })
  })

  describe('formatForCodeContext', () => {
    it.concurrent('should format plain type variables for code context', () => {
      expect(VariableManager.formatForCodeContext('hello world', 'plain')).toBe('hello world')
      expect(VariableManager.formatForCodeContext(42, 'plain')).toBe('42')
      expect(VariableManager.formatForCodeContext(true, 'plain')).toBe('true')
    })

    it.concurrent('should format string type variables for code context', () => {
      expect(VariableManager.formatForCodeContext('hello world', 'string')).toBe('"hello world"')
      expect(VariableManager.formatForCodeContext(42, 'string')).toBe('42')
      expect(VariableManager.formatForCodeContext(true, 'string')).toBe('true')
    })

    it.concurrent('should format number type variables for code context', () => {
      expect(VariableManager.formatForCodeContext(42, 'number')).toBe('42')
      expect(VariableManager.formatForCodeContext('42', 'number')).toBe('42')
    })

    it.concurrent('should format boolean type variables for code context', () => {
      expect(VariableManager.formatForCodeContext(true, 'boolean')).toBe('true')
      expect(VariableManager.formatForCodeContext(false, 'boolean')).toBe('false')
    })

    it.concurrent('should format object and array types for code context', () => {
      expect(VariableManager.formatForCodeContext({ foo: 'bar' }, 'object')).toBe('{"foo":"bar"}')
      expect(VariableManager.formatForCodeContext([1, 2, 3], 'array')).toBe('[1,2,3]')
    })

    it.concurrent('should handle null and undefined', () => {
      expect(VariableManager.formatForCodeContext(null, 'string')).toBe('null')
      expect(VariableManager.formatForCodeContext(undefined, 'number')).toBe('undefined')
    })
  })

  describe('shouldStripQuotesForDisplay', () => {
    it.concurrent('should identify strings that need quotes stripped', () => {
      expect(VariableManager.shouldStripQuotesForDisplay('"hello world"')).toBe(true)
      expect(VariableManager.shouldStripQuotesForDisplay("'hello world'")).toBe(true)
      expect(VariableManager.shouldStripQuotesForDisplay('hello world')).toBe(false)
      expect(VariableManager.shouldStripQuotesForDisplay('""')).toBe(false) // Too short
      expect(VariableManager.shouldStripQuotesForDisplay("''")).toBe(false) // Too short
    })

    it.concurrent('should handle edge cases', () => {
      expect(VariableManager.shouldStripQuotesForDisplay('')).toBe(false)
      expect(VariableManager.shouldStripQuotesForDisplay(null as any)).toBe(false)
      expect(VariableManager.shouldStripQuotesForDisplay(undefined as any)).toBe(false)
      expect(VariableManager.shouldStripQuotesForDisplay(42 as any)).toBe(false)
    })
  })
})

import { describe, expect, it } from 'vitest'
import { VariableManager } from '@/lib/workflows/variables/variable-manager'

describe('VariableManager', () => {
  describe('parseInputForStorage', () => {
    it.concurrent('should handle number type variables', () => {
      expect(VariableManager.parseInputForStorage('42', 'number')).toBe(42)
      expect(VariableManager.parseInputForStorage('-3.14', 'number')).toBe(-3.14)
      expect(VariableManager.parseInputForStorage('"42"', 'number')).toBe(42)
      expect(VariableManager.parseInputForStorage('not a number', 'number')).toBe(0)
    })

    it.concurrent('should handle boolean type variables', () => {
      expect(VariableManager.parseInputForStorage('true', 'boolean')).toBe(true)
      expect(VariableManager.parseInputForStorage('false', 'boolean')).toBe(false)
      expect(VariableManager.parseInputForStorage('1', 'boolean')).toBe(false)
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

    it.concurrent('should handle empty values', () => {
      expect(VariableManager.parseInputForStorage('', 'string')).toBe('')
      expect(VariableManager.parseInputForStorage('', 'number')).toBe('')
      expect(VariableManager.parseInputForStorage(null as any, 'boolean')).toBe('')
      expect(VariableManager.parseInputForStorage(undefined as any, 'object')).toBe('')
    })
  })

  describe('formatForEditor', () => {
    it.concurrent('should format object type variables for editor', () => {
      expect(VariableManager.formatForEditor({ foo: 'bar' }, 'object')).toBe('{\n  "foo": "bar"\n}')
      expect(VariableManager.formatForEditor('{"foo":"bar"}', 'object')).toBe(
        '{\n  "foo": "bar"\n}'
      )
      expect(VariableManager.formatForEditor('invalid json', 'object')).toEqual(
        '{\n  "value": "invalid json"\n}'
      )
    })
  })

  describe('resolveForExecution', () => {
    it.concurrent('should resolve boolean type variables for execution', () => {
      expect(VariableManager.resolveForExecution(true, 'boolean')).toBe(true)
      expect(VariableManager.resolveForExecution(false, 'boolean')).toBe(false)
      expect(VariableManager.resolveForExecution('true', 'boolean')).toBe(true)
      expect(VariableManager.resolveForExecution('false', 'boolean')).toBe(false)
      expect(VariableManager.resolveForExecution('1', 'boolean')).toBe(false)
      expect(VariableManager.resolveForExecution('0', 'boolean')).toBe(false)
    })

    it.concurrent('should resolve object type variables for execution', () => {
      expect(VariableManager.resolveForExecution({ foo: 'bar' }, 'object')).toEqual({ foo: 'bar' })
      expect(VariableManager.resolveForExecution('{"foo":"bar"}', 'object')).toEqual({ foo: 'bar' })
      expect(VariableManager.resolveForExecution('invalid json', 'object')).toEqual({})
    })

    it.concurrent('should handle null and undefined', () => {
      expect(VariableManager.resolveForExecution(null, 'string')).toBe(null)
      expect(VariableManager.resolveForExecution(undefined, 'number')).toBe(undefined)
    })
  })

  describe('formatForTemplateInterpolation', () => {
    it.concurrent('should format object type variables for interpolation', () => {
      expect(VariableManager.formatForTemplateInterpolation({ foo: 'bar' }, 'object')).toBe(
        '{"foo":"bar"}'
      )
      expect(VariableManager.formatForTemplateInterpolation('{"foo":"bar"}', 'object')).toBe(
        '{"foo":"bar"}'
      )
    })
  })

  describe('formatForCodeContext', () => {
    it.concurrent('should format object and array types for code context', () => {
      expect(VariableManager.formatForCodeContext({ foo: 'bar' }, 'object')).toBe('{"foo":"bar"}')
      expect(VariableManager.formatForCodeContext([1, 2, 3], 'array')).toBe('[1,2,3]')
    })

    it.concurrent('should handle null and undefined', () => {
      expect(VariableManager.formatForCodeContext(null, 'string')).toBe('null')
      expect(VariableManager.formatForCodeContext(undefined, 'number')).toBe('undefined')
    })
  })
})

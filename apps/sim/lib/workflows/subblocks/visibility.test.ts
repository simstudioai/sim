/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { evaluateSubBlockCondition } from './visibility'

describe('evaluateSubBlockCondition', () => {
  describe('simple value matching', () => {
    it.concurrent('returns true when field value matches condition value', () => {
      const condition = { field: 'operation', value: 'create_booking' }
      const values = { operation: 'create_booking' }
      expect(evaluateSubBlockCondition(condition, values)).toBe(true)
    })

    it.concurrent('returns false when field value does not match condition value', () => {
      const condition = { field: 'operation', value: 'create_booking' }
      const values = { operation: 'cancel_booking' }
      expect(evaluateSubBlockCondition(condition, values)).toBe(false)
    })

    it.concurrent('returns false when field is missing', () => {
      const condition = { field: 'operation', value: 'create_booking' }
      const values = {}
      expect(evaluateSubBlockCondition(condition, values)).toBe(false)
    })

    it.concurrent('returns false when field is undefined', () => {
      const condition = { field: 'operation', value: 'create_booking' }
      const values = { operation: undefined }
      expect(evaluateSubBlockCondition(condition, values)).toBe(false)
    })

    it.concurrent('returns false when field is null', () => {
      const condition = { field: 'operation', value: 'create_booking' }
      const values = { operation: null }
      expect(evaluateSubBlockCondition(condition, values)).toBe(false)
    })
  })

  describe('array value matching', () => {
    it.concurrent('returns true when field value is in condition array', () => {
      const condition = { field: 'operation', value: ['create_booking', 'update_booking'] }
      const values = { operation: 'create_booking' }
      expect(evaluateSubBlockCondition(condition, values)).toBe(true)
    })

    it.concurrent('returns true for second array value', () => {
      const condition = { field: 'operation', value: ['create_booking', 'update_booking'] }
      const values = { operation: 'update_booking' }
      expect(evaluateSubBlockCondition(condition, values)).toBe(true)
    })

    it.concurrent('returns false when field value is not in condition array', () => {
      const condition = { field: 'operation', value: ['create_booking', 'update_booking'] }
      const values = { operation: 'cancel_booking' }
      expect(evaluateSubBlockCondition(condition, values)).toBe(false)
    })

    it.concurrent('returns false when field is undefined with array condition', () => {
      const condition = { field: 'operation', value: ['create_booking', 'update_booking'] }
      const values = { operation: undefined }
      expect(evaluateSubBlockCondition(condition, values)).toBe(false)
    })

    it.concurrent('returns false when field is null with array condition', () => {
      const condition = { field: 'operation', value: ['create_booking', 'update_booking'] }
      const values = { operation: null }
      expect(evaluateSubBlockCondition(condition, values)).toBe(false)
    })
  })

  describe('negation with not flag', () => {
    it.concurrent('returns false when field matches but not is true', () => {
      const condition = { field: 'operation', value: 'create_booking', not: true }
      const values = { operation: 'create_booking' }
      expect(evaluateSubBlockCondition(condition, values)).toBe(false)
    })

    it.concurrent('returns true when field does not match and not is true', () => {
      const condition = { field: 'operation', value: 'create_booking', not: true }
      const values = { operation: 'cancel_booking' }
      expect(evaluateSubBlockCondition(condition, values)).toBe(true)
    })

    it.concurrent('returns true when field is not in array and not is true', () => {
      const condition = {
        field: 'operation',
        value: ['create_booking', 'update_booking'],
        not: true,
      }
      const values = { operation: 'cancel_booking' }
      expect(evaluateSubBlockCondition(condition, values)).toBe(true)
    })

    it.concurrent('returns false when field is in array and not is true', () => {
      const condition = {
        field: 'operation',
        value: ['create_booking', 'update_booking'],
        not: true,
      }
      const values = { operation: 'create_booking' }
      expect(evaluateSubBlockCondition(condition, values)).toBe(false)
    })
  })

  describe('compound conditions with and', () => {
    it.concurrent('returns true when both conditions match', () => {
      const condition = {
        field: 'operation',
        value: 'create_booking',
        and: { field: 'hasEmail', value: true },
      }
      const values = { operation: 'create_booking', hasEmail: true }
      expect(evaluateSubBlockCondition(condition, values)).toBe(true)
    })

    it.concurrent('returns false when first condition matches but and condition fails', () => {
      const condition = {
        field: 'operation',
        value: 'create_booking',
        and: { field: 'hasEmail', value: true },
      }
      const values = { operation: 'create_booking', hasEmail: false }
      expect(evaluateSubBlockCondition(condition, values)).toBe(false)
    })

    it.concurrent('returns false when first condition fails but and condition matches', () => {
      const condition = {
        field: 'operation',
        value: 'create_booking',
        and: { field: 'hasEmail', value: true },
      }
      const values = { operation: 'cancel_booking', hasEmail: true }
      expect(evaluateSubBlockCondition(condition, values)).toBe(false)
    })

    it.concurrent('returns false when both conditions fail', () => {
      const condition = {
        field: 'operation',
        value: 'create_booking',
        and: { field: 'hasEmail', value: true },
      }
      const values = { operation: 'cancel_booking', hasEmail: false }
      expect(evaluateSubBlockCondition(condition, values)).toBe(false)
    })
  })

  describe('edge cases', () => {
    it.concurrent('returns true when condition is undefined', () => {
      expect(evaluateSubBlockCondition(undefined, { operation: 'anything' })).toBe(true)
    })

    it.concurrent('handles function conditions', () => {
      const condition = () => ({ field: 'operation', value: 'create_booking' })
      const values = { operation: 'create_booking' }
      expect(evaluateSubBlockCondition(condition, values)).toBe(true)
    })

    it.concurrent('passes current values into function conditions', () => {
      const condition = (values?: Record<string, unknown>) => ({
        field: 'model',
        value: typeof values?.model === 'string' ? values.model : '__no_model_selected__',
      })
      const values = { model: 'ollama/gemma3:4b' }
      expect(evaluateSubBlockCondition(condition, values)).toBe(true)
    })

    it.concurrent('handles boolean values', () => {
      const condition = { field: 'enabled', value: true }
      const values = { enabled: true }
      expect(evaluateSubBlockCondition(condition, values)).toBe(true)
    })

    it.concurrent('handles numeric values', () => {
      const condition = { field: 'count', value: 5 }
      const values = { count: 5 }
      expect(evaluateSubBlockCondition(condition, values)).toBe(true)
    })
  })
})

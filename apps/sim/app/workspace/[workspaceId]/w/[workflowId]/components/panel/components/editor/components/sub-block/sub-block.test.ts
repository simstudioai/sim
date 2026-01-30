/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { SubBlockConfig } from '@/blocks/types'

const isFieldRequired = (config: SubBlockConfig, subBlockValues?: Record<string, any>): boolean => {
  if (!config.required) return false
  if (typeof config.required === 'boolean') return config.required

  const evalCond = (
    cond: {
      field: string
      value: string | number | boolean | Array<string | number | boolean>
      not?: boolean
      and?: {
        field: string
        value: string | number | boolean | Array<string | number | boolean> | undefined
        not?: boolean
      }
    },
    values: Record<string, any>
  ): boolean => {
    const fieldValue = values[cond.field]?.value
    const condValue = cond.value

    let match: boolean
    if (Array.isArray(condValue)) {
      match = condValue.includes(fieldValue)
    } else {
      match = fieldValue === condValue
    }

    if (cond.not) match = !match

    if (cond.and) {
      const andFieldValue = values[cond.and.field]?.value
      const andCondValue = cond.and.value
      let andMatch: boolean
      if (Array.isArray(andCondValue)) {
        andMatch = andCondValue.includes(andFieldValue)
      } else {
        andMatch = andFieldValue === andCondValue
      }
      if (cond.and.not) andMatch = !andMatch
      match = match && andMatch
    }

    return match
  }

  const condition = typeof config.required === 'function' ? config.required() : config.required
  return evalCond(condition, subBlockValues || {})
}

describe('isFieldRequired', () => {
  describe('boolean required', () => {
    it.concurrent('returns false when required is not set', () => {
      const config = { id: 'test', type: 'short-input' } as SubBlockConfig
      expect(isFieldRequired(config, {})).toBe(false)
    })

    it.concurrent('returns false when required is false', () => {
      const config = { id: 'test', type: 'short-input', required: false } as SubBlockConfig
      expect(isFieldRequired(config, {})).toBe(false)
    })

    it.concurrent('returns true when required is true', () => {
      const config = { id: 'test', type: 'short-input', required: true } as SubBlockConfig
      expect(isFieldRequired(config, {})).toBe(true)
    })
  })

  describe('conditional required - simple value matching', () => {
    it.concurrent('returns true when field value matches condition value', () => {
      const config = {
        id: 'test',
        type: 'short-input',
        required: { field: 'operation', value: 'create_booking' },
      } as SubBlockConfig
      const values = { operation: { value: 'create_booking' } }
      expect(isFieldRequired(config, values)).toBe(true)
    })

    it.concurrent('returns false when field value does not match condition value', () => {
      const config = {
        id: 'test',
        type: 'short-input',
        required: { field: 'operation', value: 'create_booking' },
      } as SubBlockConfig
      const values = { operation: { value: 'cancel_booking' } }
      expect(isFieldRequired(config, values)).toBe(false)
    })

    it.concurrent('returns false when field is missing', () => {
      const config = {
        id: 'test',
        type: 'short-input',
        required: { field: 'operation', value: 'create_booking' },
      } as SubBlockConfig
      expect(isFieldRequired(config, {})).toBe(false)
    })

    it.concurrent('returns false when field value is undefined', () => {
      const config = {
        id: 'test',
        type: 'short-input',
        required: { field: 'operation', value: 'create_booking' },
      } as SubBlockConfig
      const values = { operation: { value: undefined } }
      expect(isFieldRequired(config, values)).toBe(false)
    })
  })

  describe('conditional required - array value matching', () => {
    it.concurrent('returns true when field value is in condition array', () => {
      const config = {
        id: 'test',
        type: 'short-input',
        required: { field: 'operation', value: ['create_booking', 'update_booking'] },
      } as SubBlockConfig
      const values = { operation: { value: 'create_booking' } }
      expect(isFieldRequired(config, values)).toBe(true)
    })

    it.concurrent('returns false when field value is not in condition array', () => {
      const config = {
        id: 'test',
        type: 'short-input',
        required: { field: 'operation', value: ['create_booking', 'update_booking'] },
      } as SubBlockConfig
      const values = { operation: { value: 'cancel_booking' } }
      expect(isFieldRequired(config, values)).toBe(false)
    })
  })

  describe('conditional required - negation', () => {
    it.concurrent('returns false when field matches but not is true', () => {
      const config = {
        id: 'test',
        type: 'short-input',
        required: { field: 'operation', value: 'create_booking', not: true },
      } as SubBlockConfig
      const values = { operation: { value: 'create_booking' } }
      expect(isFieldRequired(config, values)).toBe(false)
    })

    it.concurrent('returns true when field does not match and not is true', () => {
      const config = {
        id: 'test',
        type: 'short-input',
        required: { field: 'operation', value: 'create_booking', not: true },
      } as SubBlockConfig
      const values = { operation: { value: 'cancel_booking' } }
      expect(isFieldRequired(config, values)).toBe(true)
    })
  })

  describe('conditional required - compound conditions', () => {
    it.concurrent('returns true when both conditions match', () => {
      const config = {
        id: 'test',
        type: 'short-input',
        required: {
          field: 'operation',
          value: 'create_booking',
          and: { field: 'hasEmail', value: true },
        },
      } as SubBlockConfig
      const values = {
        operation: { value: 'create_booking' },
        hasEmail: { value: true },
      }
      expect(isFieldRequired(config, values)).toBe(true)
    })

    it.concurrent('returns false when first matches but and fails', () => {
      const config = {
        id: 'test',
        type: 'short-input',
        required: {
          field: 'operation',
          value: 'create_booking',
          and: { field: 'hasEmail', value: true },
        },
      } as SubBlockConfig
      const values = {
        operation: { value: 'create_booking' },
        hasEmail: { value: false },
      }
      expect(isFieldRequired(config, values)).toBe(false)
    })
  })
})

describe('condition + required equivalence', () => {
  const conditionValue = { field: 'operation', value: 'calcom_create_booking' }

  const configWithConditionalRequired = {
    id: 'attendeeName',
    type: 'short-input',
    condition: conditionValue,
    required: conditionValue,
  } as SubBlockConfig

  const configWithSimpleRequired = {
    id: 'attendeeName',
    type: 'short-input',
    condition: conditionValue,
    required: true,
  } as SubBlockConfig

  describe('when condition IS met (field is visible)', () => {
    const valuesWhenVisible = { operation: { value: 'calcom_create_booking' } }

    it.concurrent('conditional required returns true', () => {
      expect(isFieldRequired(configWithConditionalRequired, valuesWhenVisible)).toBe(true)
    })

    it.concurrent('simple required returns true', () => {
      expect(isFieldRequired(configWithSimpleRequired, valuesWhenVisible)).toBe(true)
    })

    it.concurrent('both configs produce the same result', () => {
      const conditionalResult = isFieldRequired(configWithConditionalRequired, valuesWhenVisible)
      const simpleResult = isFieldRequired(configWithSimpleRequired, valuesWhenVisible)
      expect(conditionalResult).toBe(simpleResult)
    })
  })

  describe('when condition is NOT met (field is hidden)', () => {
    const valuesWhenHidden = { operation: { value: 'calcom_cancel_booking' } }

    it.concurrent('conditional required returns false', () => {
      expect(isFieldRequired(configWithConditionalRequired, valuesWhenHidden)).toBe(false)
    })

    it.concurrent('simple required returns true but field is hidden', () => {
      expect(isFieldRequired(configWithSimpleRequired, valuesWhenHidden)).toBe(true)
    })

    it.concurrent('results differ but field is hidden when condition fails', () => {
      const conditionalResult = isFieldRequired(configWithConditionalRequired, valuesWhenHidden)
      const simpleResult = isFieldRequired(configWithSimpleRequired, valuesWhenHidden)
      expect(conditionalResult).not.toBe(simpleResult)
    })
  })

  describe('practical equivalence for user-facing behavior', () => {
    it.concurrent('when field is visible both show required indicator', () => {
      const valuesWhenVisible = { operation: { value: 'calcom_create_booking' } }
      const showsRequiredIndicatorA = isFieldRequired(
        configWithConditionalRequired,
        valuesWhenVisible
      )
      const showsRequiredIndicatorB = isFieldRequired(configWithSimpleRequired, valuesWhenVisible)
      expect(showsRequiredIndicatorA).toBe(true)
      expect(showsRequiredIndicatorB).toBe(true)
    })
  })
})

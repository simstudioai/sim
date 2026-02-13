/**
 * Tests for knowledge tag validation utility functions
 *
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { parseBooleanValue, parseDateValue, parseNumberValue, validateTagValue } from './utils'

describe('Knowledge Tag Utils', () => {
  describe('validateTagValue', () => {
    describe('boolean validation', () => {
      it('should accept "true" as valid boolean', () => {
        expect(validateTagValue('isActive', 'true', 'boolean')).toBeNull()
      })

      it('should accept "false" as valid boolean', () => {
        expect(validateTagValue('isActive', 'false', 'boolean')).toBeNull()
      })

      it('should accept case-insensitive boolean values', () => {
        expect(validateTagValue('isActive', 'TRUE', 'boolean')).toBeNull()
        expect(validateTagValue('isActive', 'FALSE', 'boolean')).toBeNull()
        expect(validateTagValue('isActive', 'True', 'boolean')).toBeNull()
      })

      it('should reject invalid boolean values', () => {
        const result = validateTagValue('isActive', 'yes', 'boolean')
        expect(result).toContain('expects a boolean value')
      })
    })

    describe('number validation', () => {
      it('should accept valid integers', () => {
        expect(validateTagValue('count', '42', 'number')).toBeNull()
        expect(validateTagValue('count', '-10', 'number')).toBeNull()
        expect(validateTagValue('count', '0', 'number')).toBeNull()
      })

      it('should accept valid decimals', () => {
        expect(validateTagValue('price', '19.99', 'number')).toBeNull()
        expect(validateTagValue('price', '-3.14', 'number')).toBeNull()
      })

      it('should reject non-numeric values', () => {
        const result = validateTagValue('count', 'abc', 'number')
        expect(result).toContain('expects a number value')
      })
    })

    describe('date validation', () => {
      it('should accept valid YYYY-MM-DD format', () => {
        expect(validateTagValue('createdAt', '2024-01-15', 'date')).toBeNull()
        expect(validateTagValue('createdAt', '2024-12-31', 'date')).toBeNull()
      })

      it('should accept valid ISO 8601 timestamp without timezone', () => {
        expect(validateTagValue('createdAt', '2024-01-15T14:30:00', 'date')).toBeNull()
        expect(validateTagValue('createdAt', '2024-01-15T00:00:00', 'date')).toBeNull()
        expect(validateTagValue('createdAt', '2024-01-15T23:59:59', 'date')).toBeNull()
      })

      it('should accept valid ISO 8601 timestamp with seconds omitted', () => {
        expect(validateTagValue('createdAt', '2024-01-15T14:30', 'date')).toBeNull()
      })

      it('should accept valid ISO 8601 timestamp with UTC timezone', () => {
        expect(validateTagValue('createdAt', '2024-01-15T14:30:00Z', 'date')).toBeNull()
      })

      it('should accept valid ISO 8601 timestamp with timezone offset', () => {
        expect(validateTagValue('createdAt', '2024-01-15T14:30:00+05:00', 'date')).toBeNull()
        expect(validateTagValue('createdAt', '2024-01-15T14:30:00-08:00', 'date')).toBeNull()
      })

      it('should accept valid ISO 8601 timestamp with milliseconds', () => {
        expect(validateTagValue('createdAt', '2024-01-15T14:30:00.123Z', 'date')).toBeNull()
      })

      it('should reject invalid date format', () => {
        const result = validateTagValue('createdAt', '01/15/2024', 'date')
        expect(result).toContain('expects a date in YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss format')
      })

      it('should reject invalid date values like Feb 31', () => {
        const result = validateTagValue('createdAt', '2024-02-31', 'date')
        expect(result).toContain('invalid date')
      })

      it('should reject invalid time values', () => {
        const result = validateTagValue('createdAt', '2024-01-15T25:00:00', 'date')
        expect(result).toContain('invalid time')
      })

      it('should reject invalid minute values', () => {
        const result = validateTagValue('createdAt', '2024-01-15T12:61:00', 'date')
        expect(result).toContain('invalid time')
      })
    })

    describe('text/default validation', () => {
      it('should accept any string for text type', () => {
        expect(validateTagValue('name', 'anything goes', 'text')).toBeNull()
        expect(validateTagValue('name', '123', 'text')).toBeNull()
        expect(validateTagValue('name', '', 'text')).toBeNull()
      })
    })
  })

  describe('parseDateValue', () => {
    it('should parse valid YYYY-MM-DD format', () => {
      const result = parseDateValue('2024-01-15')
      expect(result).toBeInstanceOf(Date)
      expect(result?.getFullYear()).toBe(2024)
      expect(result?.getMonth()).toBe(0) // January is 0
      expect(result?.getDate()).toBe(15)
    })

    it('should parse valid ISO 8601 timestamp', () => {
      const result = parseDateValue('2024-01-15T14:30:00')
      expect(result).toBeInstanceOf(Date)
      expect(result?.getFullYear()).toBe(2024)
      expect(result?.getMonth()).toBe(0)
      expect(result?.getDate()).toBe(15)
      expect(result?.getHours()).toBe(14)
      expect(result?.getMinutes()).toBe(30)
    })

    it('should parse valid ISO 8601 timestamp with UTC timezone', () => {
      const result = parseDateValue('2024-01-15T14:30:00Z')
      expect(result).toBeInstanceOf(Date)
      expect(result?.getFullYear()).toBe(2024)
    })

    it('should return null for invalid format', () => {
      expect(parseDateValue('01/15/2024')).toBeNull()
      expect(parseDateValue('invalid')).toBeNull()
      expect(parseDateValue('')).toBeNull()
    })

    it('should return null for invalid date values', () => {
      expect(parseDateValue('2024-02-31')).toBeNull() // Feb 31 doesn't exist
      expect(parseDateValue('2024-13-01')).toBeNull() // Month 13 doesn't exist
    })
  })

  describe('parseNumberValue', () => {
    it('should parse valid integers', () => {
      expect(parseNumberValue('42')).toBe(42)
      expect(parseNumberValue('-10')).toBe(-10)
      expect(parseNumberValue('0')).toBe(0)
    })

    it('should parse valid decimals', () => {
      expect(parseNumberValue('19.99')).toBe(19.99)
      expect(parseNumberValue('-3.14')).toBeCloseTo(-3.14)
    })

    it('should return null for non-numeric strings', () => {
      expect(parseNumberValue('abc')).toBeNull()
    })

    it('should return 0 for empty string (JavaScript Number behavior)', () => {
      expect(parseNumberValue('')).toBe(0)
    })
  })

  describe('parseBooleanValue', () => {
    it('should parse "true" to true', () => {
      expect(parseBooleanValue('true')).toBe(true)
      expect(parseBooleanValue('TRUE')).toBe(true)
      expect(parseBooleanValue(' true ')).toBe(true)
    })

    it('should parse "false" to false', () => {
      expect(parseBooleanValue('false')).toBe(false)
      expect(parseBooleanValue('FALSE')).toBe(false)
      expect(parseBooleanValue(' false ')).toBe(false)
    })

    it('should return null for invalid values', () => {
      expect(parseBooleanValue('yes')).toBeNull()
      expect(parseBooleanValue('no')).toBeNull()
      expect(parseBooleanValue('1')).toBeNull()
      expect(parseBooleanValue('')).toBeNull()
    })
  })
})

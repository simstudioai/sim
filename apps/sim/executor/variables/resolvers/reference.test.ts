import { describe, expect, it } from 'vitest'
import { navigatePath } from './reference'

describe('navigatePath', () => {
  describe('basic property access', () => {
    it.concurrent('should access top-level property', () => {
      const obj = { name: 'test', value: 42 }
      expect(navigatePath(obj, ['name'])).toBe('test')
      expect(navigatePath(obj, ['value'])).toBe(42)
    })

    it.concurrent('should access nested properties', () => {
      const obj = { a: { b: { c: 'deep' } } }
      expect(navigatePath(obj, ['a', 'b', 'c'])).toBe('deep')
    })

    it.concurrent('should return entire object for empty path', () => {
      const obj = { name: 'test' }
      expect(navigatePath(obj, [])).toEqual(obj)
    })

    it.concurrent('should handle deeply nested objects', () => {
      const obj = { level1: { level2: { level3: { level4: { value: 'found' } } } } }
      expect(navigatePath(obj, ['level1', 'level2', 'level3', 'level4', 'value'])).toBe('found')
    })
  })

  describe('array indexing', () => {
    it.concurrent('should access array elements with numeric string index', () => {
      const obj = { items: ['a', 'b', 'c'] }
      expect(navigatePath(obj, ['items', '0'])).toBe('a')
      expect(navigatePath(obj, ['items', '1'])).toBe('b')
      expect(navigatePath(obj, ['items', '2'])).toBe('c')
    })

    it.concurrent('should access array elements with bracket notation', () => {
      const obj = { items: [{ name: 'first' }, { name: 'second' }] }
      expect(navigatePath(obj, ['items[0]', 'name'])).toBe('first')
      expect(navigatePath(obj, ['items[1]', 'name'])).toBe('second')
    })

    it.concurrent('should access nested arrays', () => {
      const obj = {
        matrix: [
          [1, 2],
          [3, 4],
          [5, 6],
        ],
      }
      expect(navigatePath(obj, ['matrix', '0', '0'])).toBe(1)
      expect(navigatePath(obj, ['matrix', '1', '1'])).toBe(4)
      expect(navigatePath(obj, ['matrix', '2', '0'])).toBe(5)
    })

    it.concurrent('should access array element properties', () => {
      const obj = {
        users: [
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
        ],
      }
      expect(navigatePath(obj, ['users', '0', 'name'])).toBe('Alice')
      expect(navigatePath(obj, ['users', '1', 'id'])).toBe(2)
    })
  })

  describe('edge cases', () => {
    it.concurrent('should return undefined for non-existent property', () => {
      const obj = { name: 'test' }
      expect(navigatePath(obj, ['nonexistent'])).toBeUndefined()
    })

    it.concurrent('should return undefined for path through null', () => {
      const obj = { data: null }
      expect(navigatePath(obj, ['data', 'value'])).toBeUndefined()
    })

    it.concurrent('should return undefined for path through undefined', () => {
      const obj: Record<string, any> = { data: undefined }
      expect(navigatePath(obj, ['data', 'value'])).toBeUndefined()
    })

    it.concurrent('should return null when accessing null property', () => {
      const obj = { value: null }
      expect(navigatePath(obj, ['value'])).toBeNull()
    })

    it.concurrent('should return undefined for out of bounds array access', () => {
      const obj = { items: ['a', 'b'] }
      expect(navigatePath(obj, ['items', '10'])).toBeUndefined()
    })

    it.concurrent('should return undefined when accessing array property on non-array', () => {
      const obj = { data: 'string' }
      expect(navigatePath(obj, ['data', '0'])).toBeUndefined()
    })

    it.concurrent('should handle empty object', () => {
      const obj = {}
      expect(navigatePath(obj, ['any'])).toBeUndefined()
    })

    it.concurrent('should handle object with empty string key', () => {
      const obj = { '': 'empty key value' }
      expect(navigatePath(obj, [''])).toBe('empty key value')
    })
  })

  describe('mixed access patterns', () => {
    it.concurrent('should handle complex nested structures', () => {
      const obj = {
        users: [
          {
            name: 'Alice',
            addresses: [
              { city: 'NYC', zip: '10001' },
              { city: 'LA', zip: '90001' },
            ],
          },
          {
            name: 'Bob',
            addresses: [{ city: 'Chicago', zip: '60601' }],
          },
        ],
      }

      expect(navigatePath(obj, ['users', '0', 'name'])).toBe('Alice')
      expect(navigatePath(obj, ['users', '0', 'addresses', '1', 'city'])).toBe('LA')
      expect(navigatePath(obj, ['users', '1', 'addresses', '0', 'zip'])).toBe('60601')
    })

    it.concurrent('should return undefined for numeric keys on non-array objects', () => {
      // navigatePath treats numeric strings as array indices only for arrays
      // For objects with numeric string keys, the numeric check takes precedence
      // and returns undefined since the object is not an array
      const obj = { data: { '0': 'zero', '1': 'one' } }
      expect(navigatePath(obj, ['data', '0'])).toBeUndefined()
      expect(navigatePath(obj, ['data', '1'])).toBeUndefined()
    })

    it.concurrent('should access non-numeric string keys', () => {
      const obj = { data: { first: 'value1', second: 'value2' } }
      expect(navigatePath(obj, ['data', 'first'])).toBe('value1')
      expect(navigatePath(obj, ['data', 'second'])).toBe('value2')
    })
  })

  describe('special value types', () => {
    it.concurrent('should return boolean values', () => {
      const obj = { active: true, disabled: false }
      expect(navigatePath(obj, ['active'])).toBe(true)
      expect(navigatePath(obj, ['disabled'])).toBe(false)
    })

    it.concurrent('should return numeric values including zero', () => {
      const obj = { count: 0, value: -5, decimal: 3.14 }
      expect(navigatePath(obj, ['count'])).toBe(0)
      expect(navigatePath(obj, ['value'])).toBe(-5)
      expect(navigatePath(obj, ['decimal'])).toBe(3.14)
    })

    it.concurrent('should return empty string', () => {
      const obj = { text: '' }
      expect(navigatePath(obj, ['text'])).toBe('')
    })

    it.concurrent('should return empty array', () => {
      const obj = { items: [] }
      expect(navigatePath(obj, ['items'])).toEqual([])
    })

    it.concurrent('should return function values', () => {
      const fn = () => 'test'
      const obj = { callback: fn }
      expect(navigatePath(obj, ['callback'])).toBe(fn)
    })
  })

  describe('bracket notation edge cases', () => {
    it.concurrent('should handle bracket notation with property access', () => {
      const obj = { data: [{ value: 100 }, { value: 200 }] }
      expect(navigatePath(obj, ['data[0]'])).toEqual({ value: 100 })
    })

    it.concurrent('should return undefined for bracket notation on non-existent property', () => {
      const obj = { data: [1, 2, 3] }
      expect(navigatePath(obj, ['nonexistent[0]'])).toBeUndefined()
    })

    it.concurrent('should return undefined for bracket notation with null property', () => {
      const obj = { data: null }
      expect(navigatePath(obj, ['data[0]'])).toBeUndefined()
    })

    it.concurrent('should return undefined for bracket notation on non-array', () => {
      const obj = { data: 'string' }
      expect(navigatePath(obj, ['data[0]'])).toBeUndefined()
    })
  })
})

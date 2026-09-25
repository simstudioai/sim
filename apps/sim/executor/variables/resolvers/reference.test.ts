import { describe, expect, it } from 'vitest'
import { navigatePath } from './reference'

describe('navigatePath', () => {
  describe('array indexing', () => {
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
    it.concurrent('should return undefined when accessing array property on non-array', () => {
      const obj = { data: 'string' }
      expect(navigatePath(obj, ['data', '0'])).toBeUndefined()
    })
  })

  describe('mixed access patterns', () => {
    it.concurrent('should return undefined for numeric keys on non-array objects', () => {
      // navigatePath treats numeric strings as array indices only for arrays
      // For objects with numeric string keys, the numeric check takes precedence
      // and returns undefined since the object is not an array
      const obj = { data: { '0': 'zero', '1': 'one' } }
      expect(navigatePath(obj, ['data', '0'])).toBeUndefined()
      expect(navigatePath(obj, ['data', '1'])).toBeUndefined()
    })
  })

  describe('large array manifests', () => {
    it('returns undefined for sync index access when the chunk is not cached', () => {
      const manifest = {
        __simLargeArrayManifest: true,
        version: 2,
        kind: 'array',
        totalCount: 1,
        chunkCount: 1,
        byteSize: 16,
        chunks: [
          {
            ref: {
              __simLargeValueRef: true,
              version: 1,
              id: 'lv_ABCDEFGHIJKL',
              kind: 'array',
              size: 16,
              executionId: 'execution-1',
            },
            count: 1,
            byteSize: 16,
          },
        ],
        preview: [{ id: 1 }],
      }

      expect(navigatePath(manifest, ['0'])).toBeUndefined()
      expect(navigatePath(manifest, ['length'])).toBe(1)
      expect(navigatePath(manifest, ['preview'])).toEqual([{ id: 1 }])
    })
  })
})

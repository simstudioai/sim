import { describe, expect, it } from 'vitest'
import { normalizeFileInput } from './utils'

describe('normalizeFileInput', () => {
  describe('URL string handling', () => {
    it('should return URL string as-is for single option', () => {
      const url = 'https://example.com/photo.jpg'
      const result = normalizeFileInput(url, { single: true })
      expect(result).toBe(url)
    })

    it('should return URL in array for non-single option', () => {
      const url = 'https://example.com/photo.jpg'
      const result = normalizeFileInput(url, { single: false })
      expect(result).toEqual([url])
    })

    it('should handle HTTP URLs', () => {
      const url = 'http://example.com/photo.jpg'
      const result = normalizeFileInput(url, { single: true })
      expect(result).toBe(url)
    })

    it('should trim whitespace from URLs', () => {
      const url = '  https://example.com/photo.jpg  '
      const result = normalizeFileInput(url, { single: true })
      expect(result).toBe('https://example.com/photo.jpg')
    })

    it('should return undefined for non-URL strings that fail JSON parse', () => {
      const notAUrl = 'just some text'
      const result = normalizeFileInput(notAUrl, { single: true })
      expect(result).toBeUndefined()
    })
  })

  describe('JSON string handling', () => {
    it('should parse JSON string to object for single option', () => {
      const fileObj = { name: 'test.jpg', url: 'https://example.com/test.jpg' }
      const result = normalizeFileInput(JSON.stringify(fileObj), { single: true })
      expect(result).toEqual(fileObj)
    })

    it('should parse JSON string array for non-single option', () => {
      const fileArray = [
        { name: 'test1.jpg', url: 'https://example.com/test1.jpg' },
        { name: 'test2.jpg', url: 'https://example.com/test2.jpg' },
      ]
      const result = normalizeFileInput(JSON.stringify(fileArray), { single: false })
      expect(result).toEqual(fileArray)
    })
  })

  describe('Object and array handling', () => {
    it('should return single object wrapped in array for non-single option', () => {
      const fileObj = { name: 'test.jpg', url: 'https://example.com/test.jpg' }
      const result = normalizeFileInput(fileObj, { single: false })
      expect(result).toEqual([fileObj])
    })

    it('should return single object as-is for single option', () => {
      const fileObj = { name: 'test.jpg', url: 'https://example.com/test.jpg' }
      const result = normalizeFileInput(fileObj, { single: true })
      expect(result).toEqual(fileObj)
    })

    it('should return array as-is for non-single option', () => {
      const fileArray = [
        { name: 'test1.jpg', url: 'https://example.com/test1.jpg' },
        { name: 'test2.jpg', url: 'https://example.com/test2.jpg' },
      ]
      const result = normalizeFileInput(fileArray, { single: false })
      expect(result).toEqual(fileArray)
    })
  })

  describe('Edge cases', () => {
    it('should return undefined for null', () => {
      const result = normalizeFileInput(null, { single: true })
      expect(result).toBeUndefined()
    })

    it('should return undefined for undefined', () => {
      const result = normalizeFileInput(undefined, { single: true })
      expect(result).toBeUndefined()
    })

    it('should return undefined for empty string', () => {
      const result = normalizeFileInput('', { single: true })
      expect(result).toBeUndefined()
    })

    it('should throw error for multiple files when single is true', () => {
      const fileArray = [
        { name: 'test1.jpg', url: 'https://example.com/test1.jpg' },
        { name: 'test2.jpg', url: 'https://example.com/test2.jpg' },
      ]
      expect(() => normalizeFileInput(fileArray, { single: true })).toThrow(
        'File reference must be a single file'
      )
    })
  })
})

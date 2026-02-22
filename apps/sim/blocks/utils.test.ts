import { describe, expect, it } from 'vitest'
import { normalizeFileOrUrlInput } from '@/blocks/utils'

describe('normalizeFileOrUrlInput', () => {
  it.concurrent('returns undefined for nullish and empty values', () => {
    expect(normalizeFileOrUrlInput(undefined, { single: true })).toBeUndefined()
    expect(normalizeFileOrUrlInput(null, { single: true })).toBeUndefined()
    expect(normalizeFileOrUrlInput('', { single: true })).toBeUndefined()
    expect(normalizeFileOrUrlInput('   ', { single: true })).toBeUndefined()
  })

  it.concurrent('passes through trimmed URL/file_id strings', () => {
    expect(normalizeFileOrUrlInput(' https://example.com/a.jpg ', { single: true })).toBe(
      'https://example.com/a.jpg'
    )
    expect(normalizeFileOrUrlInput('AgACAgUAAxkBAAIB...', { single: true })).toBe(
      'AgACAgUAAxkBAAIB...'
    )
    expect(normalizeFileOrUrlInput('1234567890', { single: true })).toBe('1234567890')
  })

  it.concurrent('extracts url from a file-like object', () => {
    expect(normalizeFileOrUrlInput({ url: 'https://example.com/file.png' }, { single: true })).toBe(
      'https://example.com/file.png'
    )
  })

  it.concurrent('extracts url from JSON-stringified file objects/arrays', () => {
    expect(
      normalizeFileOrUrlInput(JSON.stringify({ url: 'https://example.com/a.png' }), {
        single: true,
      })
    ).toBe('https://example.com/a.png')

    expect(
      normalizeFileOrUrlInput(JSON.stringify([{ url: 'https://example.com/a.png' }]), {
        single: true,
      })
    ).toBe('https://example.com/a.png')
  })

  it.concurrent('throws when single=true and multiple values resolve', () => {
    expect(() =>
      normalizeFileOrUrlInput(
        JSON.stringify([{ url: 'https://a.com' }, { url: 'https://b.com' }]),
        {
          single: true,
        }
      )
    ).toThrow('File reference must be a single file')
  })

  it.concurrent('treats invalid JSON strings as raw identifiers', () => {
    expect(normalizeFileOrUrlInput('{not json', { single: true })).toBe('{not json')
  })
})

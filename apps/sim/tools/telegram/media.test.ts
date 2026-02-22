/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { normalizeTelegramMediaParam } from '@/tools/telegram/media'

describe('normalizeTelegramMediaParam', () => {
  it('accepts trimmed URL/file_id strings', () => {
    expect(normalizeTelegramMediaParam('  https://example.com/a.jpg  ', { label: 'Photo' })).toBe(
      'https://example.com/a.jpg'
    )
    expect(normalizeTelegramMediaParam('  ABC123  ', { label: 'Photo' })).toBe('ABC123')
  })

  it('accepts URL instances', () => {
    expect(
      normalizeTelegramMediaParam(new URL('https://example.com/a.jpg'), { label: 'Photo' })
    ).toBe('https://example.com/a.jpg')
  })

  it('accepts object shapes with url/href/file_id', () => {
    expect(
      normalizeTelegramMediaParam({ url: 'https://example.com/a.jpg' }, { label: 'Photo' })
    ).toBe('https://example.com/a.jpg')
    expect(
      normalizeTelegramMediaParam({ href: 'https://example.com/a.jpg' }, { label: 'Photo' })
    ).toBe('https://example.com/a.jpg')
    expect(normalizeTelegramMediaParam({ file_id: 'FILE_ID' }, { label: 'Photo' })).toBe('FILE_ID')
    expect(normalizeTelegramMediaParam({ fileId: 'FILE_ID_2' }, { label: 'Photo' })).toBe(
      'FILE_ID_2'
    )
  })

  it('parses stringified JSON objects/arrays from advanced-mode inputs', () => {
    expect(
      normalizeTelegramMediaParam('{\"url\":\"https://example.com/a.jpg\"}', { label: 'Photo' })
    ).toBe('https://example.com/a.jpg')

    expect(
      normalizeTelegramMediaParam('[{\"url\":\"https://example.com/a.jpg\"}]', { label: 'Photo' })
    ).toBe('https://example.com/a.jpg')
  })

  it('rejects missing values with a configurable message', () => {
    expect(() =>
      normalizeTelegramMediaParam('', { label: 'Photo', errorMessage: 'Photo is required.' })
    ).toThrow('Photo is required.')

    expect(() => normalizeTelegramMediaParam(undefined, { label: 'Photo' })).toThrow(
      'Photo URL or file_id is required.'
    )
  })

  it('rejects multiple values when an array is provided', () => {
    expect(() =>
      normalizeTelegramMediaParam([{ url: 'a' }, { url: 'b' }], { label: 'Photo' })
    ).toThrow('Photo reference must be a single item, not an array.')

    expect(() =>
      normalizeTelegramMediaParam('[{\"url\":\"a\"},{\"url\":\"b\"}]', { label: 'Photo' })
    ).toThrow('Photo reference must be a single item, not an array.')
  })
})

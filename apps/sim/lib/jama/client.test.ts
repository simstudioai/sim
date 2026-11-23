import { describe, expect, it } from 'vitest'
import { normalizeJamaInstanceUrl } from '@/lib/jama/client'

describe('Jama instance URLs', () => {
  it.each([
    '',
    'example.jamacloud.com',
    'https://',
    'http://example.jamacloud.com',
    'https://example.jamacloud.com/rest/v1',
  ])('explains how to fix an invalid instance URL %j', (url) => {
    expect(() => normalizeJamaInstanceUrl(url)).toThrow(
      'Enter your Jama HTTPS instance URL, without an API path'
    )
  })

  it('preserves the deployment context path while normalizing the origin and trailing slash', () => {
    expect(normalizeJamaInstanceUrl(' https://Jama.example.com/context/ ')).toBe(
      'https://jama.example.com/context'
    )
  })
})

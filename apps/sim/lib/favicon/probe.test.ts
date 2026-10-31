import { describe, expect, it } from 'vitest'
import { classifyProviderResponse, MAX_ICON_BYTES } from '@/lib/favicon/probe'

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const ICO = Uint8Array.from([0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x10, 0x10])
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10])
const GIF = new TextEncoder().encode('GIF89a......')
const WEBP = new TextEncoder().encode('RIFF\u0000\u0000\u0000\u0000WEBPVP8 ')
const HTML = new TextEncoder().encode('<!doctype html><html></html>')
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')

describe('classifyProviderResponse', () => {
  it.each([
    [PNG, 'image/png'],
    [ICO, 'image/x-icon'],
    [JPEG, 'image/jpeg'],
    [GIF, 'image/gif'],
    [WEBP, 'image/webp'],
  ] as const)('accepts a real icon and names its type from its bytes', (bytes, contentType) => {
    expect(classifyProviderResponse(200, bytes)).toEqual({ kind: 'hit', contentType })
  })

  it('counts a placeholder served with 404 as a miss, though its body is an image', () => {
    expect(classifyProviderResponse(404, PNG)).toEqual({ kind: 'miss' })
  })

  it.each([
    ['HTML', HTML],
    ['SVG', SVG],
    ['an empty body', new Uint8Array()],
  ])('counts %s served with 200 as a miss', (_label, bytes) => {
    expect(classifyProviderResponse(200, bytes)).toEqual({ kind: 'miss' })
  })

  it('counts an oversized icon as a miss', () => {
    const oversized = new Uint8Array(MAX_ICON_BYTES + 1)
    oversized.set(PNG)
    expect(classifyProviderResponse(200, oversized)).toEqual({ kind: 'miss' })
  })

  it.each([429, 500, 502, 503])('treats %i as unavailable, not as a miss', (status) => {
    expect(classifyProviderResponse(status, PNG)).toEqual({ kind: 'unavailable' })
  })
})

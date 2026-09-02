/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockParseOfficeAsync } = vi.hoisted(() => ({ mockParseOfficeAsync: vi.fn() }))

vi.mock('officeparser', () => ({ parseOfficeAsync: mockParseOfficeAsync }))

import { parseOfficeText, resolveParseOfficeAsync } from '@/lib/file-parsers/officeparser-module'

describe('resolveParseOfficeAsync', () => {
  const parse = vi.fn()

  it('resolves the named export', () => {
    expect(resolveParseOfficeAsync({ parseOfficeAsync: parse })).toBe(parse)
  })

  it('resolves a bundled default export', () => {
    expect(resolveParseOfficeAsync({ default: { parseOfficeAsync: parse } })).toBe(parse)
  })

  it('resolves a callable default export', () => {
    expect(resolveParseOfficeAsync({ default: parse })).toBe(parse)
  })

  it('throws when the entry point is absent', () => {
    expect(() => resolveParseOfficeAsync({})).toThrow('did not expose parseOfficeAsync')
  })
})

describe('parseOfficeText', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockParseOfficeAsync.mockResolvedValue('slide text')
  })

  it('preserves the legacy plain-text shape', async () => {
    const input = Buffer.from('office archive')

    await expect(parseOfficeText(input)).resolves.toBe('slide text')
    expect(mockParseOfficeAsync).toHaveBeenCalledWith(input)
  })

  it('rejects cancellation before loading the parser', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      parseOfficeText(Buffer.from('office archive'), { signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(mockParseOfficeAsync).not.toHaveBeenCalled()
  })

  it('rejects cancellation after parsing', async () => {
    const controller = new AbortController()
    mockParseOfficeAsync.mockImplementationOnce(async () => {
      controller.abort()
      return 'slide text'
    })

    await expect(
      parseOfficeText(Buffer.from('office archive'), { signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})

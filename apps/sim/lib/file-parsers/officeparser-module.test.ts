import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockParseOfficeAsync } = vi.hoisted(() => ({ mockParseOfficeAsync: vi.fn() }))

vi.mock('officeparser', () => ({ parseOfficeAsync: mockParseOfficeAsync }))

import { parseOfficeText } from '@/lib/file-parsers/officeparser-module'

const ZIP_PACKAGE = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(26)])

describe('parseOfficeText', () => {
  beforeEach(() => {
    mockParseOfficeAsync.mockResolvedValue('slide text')
  })

  it('rejects cancellation before loading the parser', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(parseOfficeText(ZIP_PACKAGE, { signal: controller.signal })).rejects.toMatchObject(
      { name: 'AbortError' }
    )
    expect(mockParseOfficeAsync).not.toHaveBeenCalled()
  })

  it('rejects cancellation after parsing', async () => {
    const controller = new AbortController()
    mockParseOfficeAsync.mockImplementationOnce(async () => {
      controller.abort()
      return 'slide text'
    })

    await expect(parseOfficeText(ZIP_PACKAGE, { signal: controller.signal })).rejects.toMatchObject(
      { name: 'AbortError' }
    )
  })
})

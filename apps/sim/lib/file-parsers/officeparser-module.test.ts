import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockParseOfficeAsync } = vi.hoisted(() => ({ mockParseOfficeAsync: vi.fn() }))

vi.mock('officeparser', () => ({ parseOfficeAsync: mockParseOfficeAsync }))

import { parseOfficeText } from '@/lib/file-parsers/officeparser-module'

const ZIP_PACKAGE = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(26)])

/**
 * GHSA-5v7r-6r5c-r473: an ASF header followed by a sub-header of size zero sends `file-type`
 * 16's ASF detector, which officeparser runs on every buffer, back over the same sub-header
 * forever. A `.docx` or `.odt` upload reached it once mammoth or the ODF walker gave up.
 */
const ASF_ZERO_SIZE_SUB_HEADER = Buffer.concat([
  Buffer.from([0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11, 0xa6, 0xd9]),
  Buffer.alloc(45),
])

describe('parseOfficeText', () => {
  beforeEach(() => {
    mockParseOfficeAsync.mockReset()
    mockParseOfficeAsync.mockResolvedValue('slide text')
  })

  it('refuses a buffer that is not a ZIP package before officeparser sniffs it', async () => {
    await expect(parseOfficeText(ASF_ZERO_SIZE_SUB_HEADER)).rejects.toMatchObject({
      code: 'invalid_format',
    })
    expect(mockParseOfficeAsync).not.toHaveBeenCalled()
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

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockParseOfficeAsync } = vi.hoisted(() => ({ mockParseOfficeAsync: vi.fn() }))

vi.mock('officeparser', () => ({ parseOfficeAsync: mockParseOfficeAsync }))

import { parseOfficeText } from '@/lib/file-parsers/officeparser-module'

describe('parseOfficeText', () => {
  beforeEach(() => {
    mockParseOfficeAsync.mockResolvedValue('slide text')
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

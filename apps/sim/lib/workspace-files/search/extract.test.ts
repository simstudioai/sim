import { fileParsersMock, fileParsersMockFns } from '@sim/testing/mocks/file-parsers.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/file-parsers', () => fileParsersMock)

import { assertKnownSizeWithinLimit } from '@/lib/core/utils/stream-limits'
import { FileParserError } from '@/lib/file-parsers/errors'
import { FILE_SEARCH_MAX_EXTRACTED_BYTES } from '@/lib/workspace-files/search/constants'
import { extractIndexText } from '@/lib/workspace-files/search/extract'

const mockIsSupportedFileType = fileParsersMockFns.mockIsSupportedFileType
mockIsSupportedFileType.mockReturnValue(false)
const mockParseBuffer = fileParsersMockFns.mockParseBuffer

const SOURCE = Buffer.from('const doc = new docx.Document({ sections: [] })', 'utf-8')
const FENCED_JSON = Buffer.from('```json\n[\n  { "a": 1 }\n]\n```\n', 'utf-8')
const BINARY = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0xff, 0xfe])

function sizeLimitError(): unknown {
  try {
    assertKnownSizeWithinLimit(2, 1, 'test')
  } catch (error) {
    return error
  }
  throw new Error('assertKnownSizeWithinLimit did not throw')
}

describe('extractIndexText', () => {
  beforeEach(() => {
    mockIsSupportedFileType.mockReturnValue(true)
  })

  it('indexes parser output for a structured format', async () => {
    const signal = new AbortController().signal
    mockParseBuffer.mockResolvedValue({ content: 'hello world', metadata: { truncated: true } })

    await expect(
      extractIndexText({ buffer: FENCED_JSON, kind: 'stored' }, 'data.json', signal)
    ).resolves.toEqual({ text: 'hello world', partial: true })
    expect(mockParseBuffer).toHaveBeenCalledWith(FENCED_JSON, 'json', {
      signal,
      pdfTextMode: 'complete',
      contentMode: 'complete',
      maxTextBytes: FILE_SEARCH_MAX_EXTRACTED_BYTES,
    })
  })

  it('indexes the raw text when the parser rejects a text file', async () => {
    mockParseBuffer.mockRejectedValue(
      new FileParserError('invalid_format', "Invalid JSON: Unexpected token '`'")
    )

    await expect(
      extractIndexText(
        { buffer: FENCED_JSON, kind: 'stored' },
        'data.json',
        new AbortController().signal
      )
    ).resolves.toEqual({ text: FENCED_JSON.toString('utf8'), partial: false })
  })

  it('rethrows a size-limit breach from the parser', async () => {
    mockParseBuffer.mockRejectedValue(sizeLimitError())

    await expect(
      extractIndexText(
        { buffer: FENCED_JSON, kind: 'stored' },
        'data.json',
        new AbortController().signal
      )
    ).rejects.toMatchObject({ reason: 'extracted_text_too_large' })
  })

  it('rethrows the abort instead of falling back once the run is aborted', async () => {
    const controller = new AbortController()
    mockParseBuffer.mockImplementation(async () => {
      controller.abort()
      throw new Error('parser interrupted')
    })

    await expect(
      extractIndexText({ buffer: FENCED_JSON, kind: 'stored' }, 'data.json', controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('skips a structured file the parser reports as degraded', async () => {
    mockParseBuffer.mockResolvedValue({ content: '', metadata: { degraded: true } })

    await expect(
      extractIndexText(
        { buffer: BINARY, kind: 'artifact' },
        'deck.pptx',
        new AbortController().signal
      )
    ).resolves.toBeNull()
  })

  it('reads generation source as text without touching the office parser', async () => {
    await expect(
      extractIndexText(
        { buffer: SOURCE, kind: 'source' },
        'report.docx',
        new AbortController().signal
      )
    ).resolves.toEqual({ text: SOURCE.toString('utf8'), partial: false })
    expect(mockParseBuffer).not.toHaveBeenCalled()
  })

  it('rejects the entire expanded document above the extraction budget', async () => {
    mockParseBuffer.mockResolvedValue({ content: 'x'.repeat(FILE_SEARCH_MAX_EXTRACTED_BYTES + 1) })
    await expect(
      extractIndexText(
        { buffer: FENCED_JSON, kind: 'stored' },
        'data.json',
        new AbortController().signal
      )
    ).rejects.toMatchObject({ reason: 'extracted_text_too_large' })
  })
})

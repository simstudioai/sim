/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockFetchWorkspaceFileBuffer,
  mockIsSupportedFileType,
  mockParseBuffer,
  mockResolveServableDoc,
} = vi.hoisted(() => ({
  mockFetchWorkspaceFileBuffer: vi.fn(),
  mockIsSupportedFileType: vi.fn(),
  mockParseBuffer: vi.fn(),
  mockResolveServableDoc: vi.fn(),
}))

vi.mock('@/lib/uploads/contexts/workspace', () => ({
  fetchWorkspaceFileBuffer: mockFetchWorkspaceFileBuffer,
}))
vi.mock('@/lib/copilot/tools/server/files/doc-compile', () => ({
  resolveServableDoc: mockResolveServableDoc,
}))
vi.mock('@/lib/file-parsers', () => ({
  isSupportedFileType: mockIsSupportedFileType,
  parseBuffer: mockParseBuffer,
}))

import { assertKnownSizeWithinLimit, isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { FileParserError } from '@/lib/file-parsers/errors'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { FILE_SEARCH_MAX_SOURCE_BYTES } from '@/lib/workspace-files/search/constants'
import { extractIndexText, loadIndexableBytes } from '@/lib/workspace-files/search/extract'

const FILE: WorkspaceFileRecord = {
  id: 'file-1',
  workspaceId: 'workspace-1',
  name: 'report.docx',
  key: 'workspace/workspace-1/report.docx',
  path: '/api/files/serve/workspace/workspace-1/report.docx',
  size: 12,
  type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  uploadedBy: 'user-1',
  uploadedAt: new Date('2026-09-01T00:00:00.000Z'),
  updatedAt: new Date('2026-09-01T00:00:00.000Z'),
}

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

describe('loadIndexableBytes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchWorkspaceFileBuffer.mockResolvedValue(SOURCE)
  })

  it('reads the compiled artifact of a generated document', async () => {
    const artifact = Buffer.from('PKcompiled')
    mockResolveServableDoc.mockResolvedValue({
      kind: 'artifact',
      buffer: artifact,
      contentType: FILE.type,
    })
    const signal = new AbortController().signal

    await expect(loadIndexableBytes(FILE, signal)).resolves.toEqual({
      buffer: artifact,
      kind: 'artifact',
    })
    expect(mockFetchWorkspaceFileBuffer).toHaveBeenCalledWith(FILE, {
      maxBytes: FILE_SEARCH_MAX_SOURCE_BYTES,
      signal,
    })
    expect(mockResolveServableDoc).toHaveBeenCalledWith(FILE.workspaceId, SOURCE, FILE.name)
  })

  it('settles for the generation source when no artifact exists, without compiling', async () => {
    mockResolveServableDoc.mockResolvedValue({ kind: 'unavailable' })

    await expect(loadIndexableBytes(FILE, new AbortController().signal)).resolves.toEqual({
      buffer: SOURCE,
      kind: 'source',
    })
  })

  it('passes stored bytes through for everything else', async () => {
    mockResolveServableDoc.mockResolvedValue({ kind: 'passthrough' })

    await expect(loadIndexableBytes(FILE, new AbortController().signal)).resolves.toEqual({
      buffer: SOURCE,
      kind: 'stored',
    })
  })

  it('refuses an artifact above the source ceiling as a size-limit breach', async () => {
    mockResolveServableDoc.mockResolvedValue({
      kind: 'artifact',
      buffer: Buffer.alloc(FILE_SEARCH_MAX_SOURCE_BYTES + 1),
      contentType: FILE.type,
    })

    await expect(loadIndexableBytes(FILE, new AbortController().signal)).rejects.toSatisfy(
      isPayloadSizeLimitError
    )
  })

  it('stops before resolving once the run is aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(loadIndexableBytes(FILE, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(mockResolveServableDoc).not.toHaveBeenCalled()
  })
})

describe('extractIndexText', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsSupportedFileType.mockReturnValue(true)
  })

  it('indexes parser output for a structured format', async () => {
    const signal = new AbortController().signal
    mockParseBuffer.mockResolvedValue({ content: 'hello world', metadata: { truncated: true } })

    await expect(
      extractIndexText({ buffer: FENCED_JSON, kind: 'stored' }, 'data.json', signal)
    ).resolves.toEqual({ text: 'hello world', partial: true })
    expect(mockParseBuffer).toHaveBeenCalledWith(FENCED_JSON, 'json', { signal })
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

  it('indexes nothing when the parser rejects a binary file', async () => {
    mockParseBuffer.mockRejectedValue(new FileParserError('invalid_format', 'not a docx'))

    await expect(
      extractIndexText(
        { buffer: BINARY, kind: 'stored' },
        'broken.docx',
        new AbortController().signal
      )
    ).resolves.toBeNull()
  })

  it('rethrows a size-limit breach from the parser', async () => {
    mockParseBuffer.mockRejectedValue(sizeLimitError())

    await expect(
      extractIndexText(
        { buffer: FENCED_JSON, kind: 'stored' },
        'data.json',
        new AbortController().signal
      )
    ).rejects.toSatisfy(isPayloadSizeLimitError)
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

  it('indexes nothing for binary bytes that have no parser', async () => {
    mockIsSupportedFileType.mockReturnValue(false)

    await expect(
      extractIndexText({ buffer: BINARY, kind: 'stored' }, 'blob.bin', new AbortController().signal)
    ).resolves.toBeNull()
    expect(mockParseBuffer).not.toHaveBeenCalled()
  })

  it('indexes an empty file as empty text', async () => {
    await expect(
      extractIndexText(
        { buffer: Buffer.alloc(0), kind: 'stored' },
        'empty.txt',
        new AbortController().signal
      )
    ).resolves.toEqual({ text: '', partial: false })
  })
})

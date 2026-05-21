/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TOOL_RESULT_MAX_INLINE_CHARS } from '@/lib/copilot/constants'

const { getOrMaterializeVFS } = vi.hoisted(() => ({
  getOrMaterializeVFS: vi.fn(),
}))

const { readChatUpload } = vi.hoisted(() => ({
  readChatUpload: vi.fn(),
}))

vi.mock('@/lib/copilot/vfs', () => ({
  getOrMaterializeVFS,
}))
vi.mock('./upload-file-reader', () => ({
  readChatUpload,
  listChatUploads: vi.fn(),
}))

import { executeVfsGrep, executeVfsRead } from './vfs'

const OVERSIZED_INLINE_CONTENT = 'x'.repeat(TOOL_RESULT_MAX_INLINE_CHARS + 1)

function makeVfs() {
  return {
    grep: vi.fn(),
    read: vi.fn(),
    readFileContent: vi.fn(),
    suggestSimilar: vi.fn().mockReturnValue([]),
  }
}

describe('vfs handlers oversize policy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fails oversized grep results with narrowing guidance', async () => {
    const vfs = makeVfs()
    vfs.grep.mockReturnValue([{ path: 'files/a.txt', line: 1, content: OVERSIZED_INLINE_CONTENT }])
    getOrMaterializeVFS.mockResolvedValue(vfs)

    const result = await executeVfsGrep(
      { pattern: 'foo', output_mode: 'content' },
      { userId: 'user-1', workflowId: 'wf-1', workspaceId: 'ws-1' }
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('more specific pattern')
    expect(result.error).toContain('context window')
  })

  it('fails oversized read results from VFS with grep guidance', async () => {
    const vfs = makeVfs()
    vfs.readFileContent.mockResolvedValue(null)
    vfs.read.mockReturnValue({ content: OVERSIZED_INLINE_CONTENT, totalLines: 1 })
    getOrMaterializeVFS.mockResolvedValue(vfs)

    const result = await executeVfsRead(
      { path: 'workflows/My Workflow/state.json' },
      { userId: 'user-1', workflowId: 'wf-1', workspaceId: 'ws-1' }
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('Use grep')
    expect(result.error).toContain('offset/limit')
    expect(result.error).toContain('context window')
  })

  it('fails file-backed oversized read placeholders with original message', async () => {
    const vfs = makeVfs()
    vfs.readFileContent.mockResolvedValue({
      content: '[File too large to display inline: big.txt (6000000 bytes, limit 5242880)]',
      totalLines: 1,
    })
    getOrMaterializeVFS.mockResolvedValue(vfs)

    const result = await executeVfsRead(
      { path: 'files/big.txt/content' },
      { userId: 'user-1', workflowId: 'wf-1', workspaceId: 'ws-1' }
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('File too large to display inline')
    expect(result.error).toContain('big.txt')
  })

  it('passes through image reads with attachment even when oversized', async () => {
    const vfs = makeVfs()
    const largeBase64 = 'A'.repeat(TOOL_RESULT_MAX_INLINE_CHARS + 1)
    vfs.readFileContent.mockResolvedValue({
      content: 'Image: chess.png (500.0KB, image/png)',
      totalLines: 1,
      attachment: {
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: largeBase64 },
      },
    })
    getOrMaterializeVFS.mockResolvedValue(vfs)

    const result = await executeVfsRead(
      { path: 'files/chess.png/content' },
      { userId: 'user-1', workflowId: 'wf-1', workspaceId: 'ws-1' }
    )

    expect(result.success).toBe(true)
    expect((result.output as { attachment?: { type: string } })?.attachment?.type).toBe('image')
  })

  it('passes through compiled file attachments even when oversized', async () => {
    const vfs = makeVfs()
    const largeBase64 = 'A'.repeat(TOOL_RESULT_MAX_INLINE_CHARS + 1)
    vfs.readFileContent.mockResolvedValue({
      content: 'Compiled file: report.pdf (500000 bytes, application/pdf)',
      totalLines: 1,
      attachment: {
        type: 'file',
        name: 'report.pdf',
        source: { type: 'base64', media_type: 'application/pdf', data: largeBase64 },
      },
    })
    getOrMaterializeVFS.mockResolvedValue(vfs)

    const result = await executeVfsRead(
      { path: 'files/reports/report.pdf/compiled' },
      { userId: 'user-1', workflowId: 'wf-1', workspaceId: 'ws-1' }
    )

    expect(result.success).toBe(true)
    expect((result.output as { attachment?: { type: string } })?.attachment?.type).toBe('file')
  })

  it('fails oversized image placeholder when image exceeds size limit', async () => {
    const vfs = makeVfs()
    vfs.readFileContent.mockResolvedValue({
      content: '[Image too large: huge.png (10.0MB, limit 5MB)]',
      totalLines: 1,
    })
    getOrMaterializeVFS.mockResolvedValue(vfs)

    const result = await executeVfsRead(
      { path: 'files/huge.png/content' },
      { userId: 'user-1', workflowId: 'wf-1', workspaceId: 'ws-1' }
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('too large')
  })

  it('reads canonical file leaf metadata without fetching dynamic content', async () => {
    const vfs = makeVfs()
    vfs.read.mockReturnValue({
      content: '{"id":"wf_123","vfsPath":"files/report.csv"}',
      totalLines: 1,
    })
    getOrMaterializeVFS.mockResolvedValue(vfs)

    const result = await executeVfsRead(
      { path: 'files/report.csv' },
      { userId: 'user-1', workflowId: 'wf-1', workspaceId: 'ws-1' }
    )

    expect(result.success).toBe(true)
    expect(vfs.readFileContent).not.toHaveBeenCalled()
    expect(vfs.read).toHaveBeenCalledWith('files/report.csv', undefined, undefined)
  })

  it('uses dynamic file reads for canonical style paths', async () => {
    const vfs = makeVfs()
    vfs.readFileContent.mockResolvedValue({
      content: '{"format":"docx"}',
      totalLines: 1,
    })
    getOrMaterializeVFS.mockResolvedValue(vfs)

    const result = await executeVfsRead(
      { path: 'files/reports/brief.docx/style' },
      { userId: 'user-1', workflowId: 'wf-1', workspaceId: 'ws-1' }
    )

    expect(result.success).toBe(true)
    expect(vfs.readFileContent).toHaveBeenCalledWith('files/reports/brief.docx/style')
    expect(vfs.read).not.toHaveBeenCalled()
  })

  it('uses dynamic file reads for canonical compiled paths', async () => {
    const vfs = makeVfs()
    vfs.readFileContent.mockResolvedValue({
      content: 'Compiled file: brief.pdf (1000 bytes, application/pdf)',
      totalLines: 1,
    })
    getOrMaterializeVFS.mockResolvedValue(vfs)

    const result = await executeVfsRead(
      { path: 'files/reports/brief.pdf/compiled' },
      { userId: 'user-1', workflowId: 'wf-1', workspaceId: 'ws-1' }
    )

    expect(result.success).toBe(true)
    expect(vfs.readFileContent).toHaveBeenCalledWith('files/reports/brief.pdf/compiled')
    expect(vfs.read).not.toHaveBeenCalled()
  })
})

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
      { path: 'files/big.txt' },
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
      { path: 'files/chess.png' },
      { userId: 'user-1', workflowId: 'wf-1', workspaceId: 'ws-1' }
    )

    expect(result.success).toBe(true)
    expect((result.output as { attachment?: { type: string } })?.attachment?.type).toBe('image')
  })

  it('fails oversized image placeholder when image exceeds size limit', async () => {
    const vfs = makeVfs()
    vfs.readFileContent.mockResolvedValue({
      content: '[Image too large: huge.png (10.0MB, limit 5MB)]',
      totalLines: 1,
    })
    getOrMaterializeVFS.mockResolvedValue(vfs)

    const result = await executeVfsRead(
      { path: 'files/huge.png' },
      { userId: 'user-1', workflowId: 'wf-1', workspaceId: 'ws-1' }
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('too large')
  })
})

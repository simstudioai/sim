/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TOOL_RESULT_MAX_INLINE_CHARS } from '@/lib/copilot/constants'

const { getOrMaterializeVFS } = vi.hoisted(() => ({
  getOrMaterializeVFS: vi.fn(),
}))

const { readChatUploadPath, listChatUploads, grepChatUploadPath, listChatUploadArchiveEntries } =
  vi.hoisted(() => ({
    readChatUploadPath: vi.fn(),
    listChatUploads: vi.fn(),
    grepChatUploadPath: vi.fn(),
    // Defaults to null (not an archive) so archive glob expansion is a no-op
    // unless a test opts in.
    listChatUploadArchiveEntries: vi.fn().mockResolvedValue(null),
  }))

vi.mock('@/lib/copilot/vfs', () => ({
  getOrMaterializeVFS,
}))
vi.mock('./upload-file-reader', () => ({
  readChatUploadPath,
  listChatUploads,
  grepChatUploadPath,
  listChatUploadArchiveEntries,
}))

import { WorkspaceFileGrepError } from '@/lib/copilot/vfs/operations'
import { executeVfsGlob, executeVfsGrep, executeVfsRead } from './vfs'

const OVERSIZED_INLINE_CONTENT = 'x'.repeat(TOOL_RESULT_MAX_INLINE_CHARS + 1)

function makeVfs() {
  return {
    grep: vi.fn(),
    grepFile: vi.fn(),
    glob: vi.fn().mockReturnValue([]),
    read: vi.fn(),
    readFileContent: vi.fn(),
    suggestSimilar: vi.fn().mockReturnValue([]),
  }
}

const GREP_CTX = { userId: 'user-1', workflowId: 'wf-1', workspaceId: 'ws-1' }
const GREP_CTX_CHAT = { ...GREP_CTX, chatId: 'chat-1' }

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

describe('vfs grep workspace-file routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('routes a single workspace file leaf to grepFile (content search)', async () => {
    const vfs = makeVfs()
    vfs.grepFile.mockResolvedValue([{ path: 'files/report.csv', line: 2, content: 'revenue,100' }])
    getOrMaterializeVFS.mockResolvedValue(vfs)

    const result = await executeVfsGrep(
      { pattern: 'revenue', path: 'files/report.csv', output_mode: 'content' },
      GREP_CTX
    )

    expect(result.success).toBe(true)
    expect(vfs.grepFile).toHaveBeenCalledWith(
      'files/report.csv',
      'revenue',
      expect.objectContaining({ outputMode: 'content', maxResults: 50 })
    )
    expect(vfs.grep).not.toHaveBeenCalled()
    expect((result.output as { matches: unknown[] }).matches).toHaveLength(1)
  })

  it('routes a files/<leaf>/content path to grepFile', async () => {
    const vfs = makeVfs()
    vfs.grepFile.mockResolvedValue([])
    getOrMaterializeVFS.mockResolvedValue(vfs)

    await executeVfsGrep({ pattern: 'x', path: 'files/reports/brief.pdf/content' }, GREP_CTX)

    expect(vfs.grepFile).toHaveBeenCalledWith(
      'files/reports/brief.pdf/content',
      'x',
      expect.any(Object)
    )
    expect(vfs.grep).not.toHaveBeenCalled()
  })

  it('uses the VFS map grep for non-file paths', async () => {
    const vfs = makeVfs()
    vfs.grep.mockReturnValue([])
    getOrMaterializeVFS.mockResolvedValue(vfs)

    await executeVfsGrep({ pattern: 'slack', path: 'workflows/' }, GREP_CTX)

    expect(vfs.grep).toHaveBeenCalledWith('slack', 'workflows/', expect.any(Object))
    expect(vfs.grepFile).not.toHaveBeenCalled()
  })

  it('uses the VFS map grep when no path is given', async () => {
    const vfs = makeVfs()
    vfs.grep.mockReturnValue([])
    getOrMaterializeVFS.mockResolvedValue(vfs)

    await executeVfsGrep({ pattern: 'slack' }, GREP_CTX)

    expect(vfs.grep).toHaveBeenCalledWith('slack', undefined, expect.any(Object))
    expect(vfs.grepFile).not.toHaveBeenCalled()
  })

  it('surfaces a workspace-file grep scope error verbatim', async () => {
    const vfs = makeVfs()
    vfs.grepFile.mockRejectedValue(
      new WorkspaceFileGrepError(
        'Grep over workspace file content must target a single workspace file (e.g. path: "files/report.csv"). "files/" is not a single workspace file.'
      )
    )
    getOrMaterializeVFS.mockResolvedValue(vfs)

    const result = await executeVfsGrep({ pattern: 'x', path: 'files/' }, GREP_CTX)

    expect(result.success).toBe(false)
    expect(result.error).toContain('single workspace file')
  })
})

describe('vfs uploads are opt-in (like recently-deleted/)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not search uploads for an unscoped grep', async () => {
    const vfs = makeVfs()
    vfs.grep.mockReturnValue([])
    getOrMaterializeVFS.mockResolvedValue(vfs)

    await executeVfsGrep({ pattern: 'secret' }, GREP_CTX_CHAT)

    expect(grepChatUploadPath).not.toHaveBeenCalled()
    expect(vfs.grep).toHaveBeenCalledWith('secret', undefined, expect.any(Object))
  })

  it('does not search uploads for a files/ grep', async () => {
    const vfs = makeVfs()
    vfs.grepFile.mockResolvedValue([])
    getOrMaterializeVFS.mockResolvedValue(vfs)

    await executeVfsGrep({ pattern: 'secret', path: 'files/report.csv' }, GREP_CTX_CHAT)

    expect(grepChatUploadPath).not.toHaveBeenCalled()
  })

  it('routes an explicit uploads/<file> path to grepChatUploadPath', async () => {
    grepChatUploadPath.mockResolvedValue([{ path: 'uploads/report.json', line: 1, content: 'hit' }])

    const result = await executeVfsGrep(
      { pattern: 'hit', path: 'uploads/report.json' },
      GREP_CTX_CHAT
    )

    expect(result.success).toBe(true)
    expect(grepChatUploadPath).toHaveBeenCalledWith(
      'report.json',
      '',
      'chat-1',
      'hit',
      expect.objectContaining({ maxResults: 50 })
    )
    expect(getOrMaterializeVFS).not.toHaveBeenCalled()
  })

  it('rejects a bare uploads/ folder grep (no cross-folder search)', async () => {
    const result = await executeVfsGrep({ pattern: 'x', path: 'uploads/' }, GREP_CTX_CHAT)

    expect(result.success).toBe(false)
    expect(result.error).toContain('single upload')
    expect(grepChatUploadPath).not.toHaveBeenCalled()
  })

  it('errors when grepping uploads without chat context', async () => {
    const result = await executeVfsGrep({ pattern: 'x', path: 'uploads/report.json' }, GREP_CTX)

    expect(result.success).toBe(false)
    expect(result.error).toContain('No chat context')
    expect(grepChatUploadPath).not.toHaveBeenCalled()
  })

  it('surfaces an upload-not-found grep error verbatim', async () => {
    grepChatUploadPath.mockRejectedValue(
      new WorkspaceFileGrepError(
        'Upload not found: "ghost.json". Use glob("uploads/*") to list available uploads.'
      )
    )

    const result = await executeVfsGrep({ pattern: 'x', path: 'uploads/ghost.json' }, GREP_CTX_CHAT)

    expect(result.success).toBe(false)
    expect(result.error).toContain('Upload not found')
  })

  it('lists uploads only when scoped, with percent-encoded paths', async () => {
    const vfs = makeVfs()
    getOrMaterializeVFS.mockResolvedValue(vfs)
    listChatUploads.mockResolvedValue([{ name: 'My Report.json' }, { name: 'data.csv' }])

    const scoped = await executeVfsGlob({ pattern: 'uploads/*' }, GREP_CTX_CHAT)
    expect((scoped.output as { files: string[] }).files).toEqual(
      expect.arrayContaining(['uploads/My%20Report.json', 'uploads/data.csv'])
    )

    listChatUploads.mockClear()
    const broad = await executeVfsGlob({ pattern: '**' }, GREP_CTX_CHAT)
    expect(listChatUploads).not.toHaveBeenCalled()
    expect((broad.output as { files: string[] }).files).not.toContain('uploads/My%20Report.json')
  })

  it('reads an upload directly, passing the first segment and any trailing suffix', async () => {
    const vfs = makeVfs()
    getOrMaterializeVFS.mockResolvedValue(vfs)
    readChatUploadPath.mockResolvedValue({ content: 'hello upload', totalLines: 1 })

    const bare = await executeVfsRead({ path: 'uploads/report.csv' }, GREP_CTX_CHAT)
    expect(bare.success).toBe(true)
    expect(readChatUploadPath).toHaveBeenLastCalledWith('report.csv', '', 'chat-1')

    // The model adds /content out of habit (from files/); the trailing segment is
    // forwarded and ignored by readChatUploadPath for a non-archive upload.
    const withContent = await executeVfsRead({ path: 'uploads/report.csv/content' }, GREP_CTX_CHAT)
    expect(withContent.success).toBe(true)
    expect(readChatUploadPath).toHaveBeenLastCalledWith('report.csv', 'content', 'chat-1')
  })

  it('forwards a trailing segment on an uploads grep path', async () => {
    grepChatUploadPath.mockResolvedValue([])

    await executeVfsGrep({ pattern: 'x', path: 'uploads/report.json/content' }, GREP_CTX_CHAT)

    expect(grepChatUploadPath).toHaveBeenCalledWith(
      'report.json',
      'content',
      'chat-1',
      'x',
      expect.any(Object)
    )
  })
})

describe('vfs archive uploads (virtual folders)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('expands a specific archive glob into its entry paths', async () => {
    const vfs = makeVfs()
    getOrMaterializeVFS.mockResolvedValue(vfs)
    listChatUploads.mockResolvedValue([{ name: 'bundle.zip' }])
    listChatUploadArchiveEntries.mockResolvedValue([
      { path: 'report.pdf', vfsPath: 'uploads/bundle.zip/report.pdf' },
      { path: 'data/sheet.csv', vfsPath: 'uploads/bundle.zip/data/sheet.csv' },
    ])

    const result = await executeVfsGlob({ pattern: 'uploads/bundle.zip/*' }, GREP_CTX_CHAT)

    expect(listChatUploadArchiveEntries).toHaveBeenCalledWith('bundle.zip', 'chat-1')
    expect((result.output as { files: string[] }).files).toEqual(
      expect.arrayContaining([
        'uploads/bundle.zip',
        'uploads/bundle.zip/report.pdf',
        'uploads/bundle.zip/data/sheet.csv',
      ])
    )
  })

  it('does not expand archives for the broad uploads/* glob', async () => {
    const vfs = makeVfs()
    getOrMaterializeVFS.mockResolvedValue(vfs)
    listChatUploads.mockResolvedValue([{ name: 'bundle.zip' }])

    await executeVfsGlob({ pattern: 'uploads/*' }, GREP_CTX_CHAT)

    expect(listChatUploadArchiveEntries).not.toHaveBeenCalled()
  })

  it('forwards a nested archive entry read to readChatUploadPath', async () => {
    readChatUploadPath.mockResolvedValue({ content: 'a,b\n1,2', totalLines: 2 })

    const result = await executeVfsRead(
      { path: 'uploads/bundle.zip/data/sheet.csv' },
      GREP_CTX_CHAT
    )

    expect(result.success).toBe(true)
    expect(readChatUploadPath).toHaveBeenCalledWith('bundle.zip', 'data/sheet.csv', 'chat-1')
  })

  it('forwards a bare archive read to readChatUploadPath with no entry', async () => {
    readChatUploadPath.mockResolvedValue({
      content: 'Archive "bundle.zip" — 2 files:\nreport.pdf\ndata/sheet.csv',
      totalLines: 3,
    })

    const result = await executeVfsRead({ path: 'uploads/bundle.zip' }, GREP_CTX_CHAT)

    expect(result.success).toBe(true)
    expect(readChatUploadPath).toHaveBeenCalledWith('bundle.zip', '', 'chat-1')
    expect((result.output as { content: string }).content).toContain('Archive "bundle.zip"')
  })

  it('forwards a nested archive entry grep to grepChatUploadPath', async () => {
    grepChatUploadPath.mockResolvedValue([
      { path: 'uploads/bundle.zip/notes.txt', line: 1, content: 'hit' },
    ])

    const result = await executeVfsGrep(
      { pattern: 'hit', path: 'uploads/bundle.zip/notes.txt' },
      GREP_CTX_CHAT
    )

    expect(result.success).toBe(true)
    expect(grepChatUploadPath).toHaveBeenCalledWith(
      'bundle.zip',
      'notes.txt',
      'chat-1',
      'hit',
      expect.any(Object)
    )
  })
})

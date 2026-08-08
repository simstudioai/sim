/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TOOL_RESULT_MAX_INLINE_CHARS } from '@/lib/copilot/constants'

const { getOrMaterializeVFS } = vi.hoisted(() => ({
  getOrMaterializeVFS: vi.fn(),
}))

const { importWorkspaceFileSecretProvenanceForModelView } = vi.hoisted(() => ({
  importWorkspaceFileSecretProvenanceForModelView: vi.fn().mockResolvedValue(true),
}))

const {
  readChatUpload,
  readChatUploadWithProvenance,
  listChatUploads,
  grepChatUpload,
  grepChatUploadWithProvenance,
} = vi.hoisted(() => {
  const readChatUpload = vi.fn()
  const grepChatUpload = vi.fn()
  return {
    readChatUpload,
    readChatUploadWithProvenance: vi.fn(async (...args: unknown[]) => {
      const value = await readChatUpload(...args)
      return value ? { value } : null
    }),
    listChatUploads: vi.fn(),
    grepChatUpload,
    grepChatUploadWithProvenance: vi.fn(async (...args: unknown[]) => ({
      value: await grepChatUpload(...args),
    })),
  }
})

vi.mock('@/lib/copilot/vfs', () => ({
  getOrMaterializeVFS,
}))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-secret-provenance', () => ({
  importWorkspaceFileSecretProvenanceForModelView,
}))
vi.mock('./upload-file-reader', () => ({
  readChatUpload,
  readChatUploadWithProvenance,
  listChatUploads,
  grepChatUpload,
  grepChatUploadWithProvenance,
}))

import { WorkspaceFileGrepError } from '@/lib/copilot/vfs/operations'
import { readPlaceholder } from '@/lib/copilot/vfs/read-placeholders'
import { executeVfsGlob, executeVfsGrep, executeVfsRead } from './vfs'

const OVERSIZED_INLINE_CONTENT = 'x'.repeat(TOOL_RESULT_MAX_INLINE_CHARS + 1)

function makeVfs() {
  const grepFile = vi.fn()
  const readFileContent = vi.fn()
  return {
    grep: vi.fn(),
    grepFile,
    grepFileWithProvenance: vi.fn(async (...args: unknown[]) => ({
      value: await grepFile(...args),
    })),
    glob: vi.fn().mockReturnValue([]),
    read: vi.fn(),
    readFileContent,
    readFileContentWithProvenance: vi.fn(async (...args: unknown[]) => {
      const value = await readFileContent(...args)
      return value ? { value } : null
    }),
    suggestSimilar: vi.fn().mockReturnValue([]),
  }
}

const GREP_CTX = { userId: 'user-1', workflowId: 'wf-1', workspaceId: 'ws-1' }
const GREP_CTX_CHAT = { ...GREP_CTX, chatId: 'chat-1' }

describe('vfs handlers oversize policy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    importWorkspaceFileSecretProvenanceForModelView.mockResolvedValue(true)
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
    vfs.readFileContent.mockResolvedValue(
      readPlaceholder.fileTooLarge('big.txt', 6_000_000, 5_242_880)
    )
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

  /**
   * Every size refusal is a failed read, whichever path produced it. Built from the
   * producers so one that stops tagging itself `oversized` fails here rather than
   * silently downgrading a refusal to a one-line "successful" read.
   */
  it.each([
    ['image', readPlaceholder.imageTooLarge('huge.png', 99, 5)],
    ['file', readPlaceholder.fileTooLarge('huge.txt', 99, 5)],
    ['document', readPlaceholder.documentTooLarge('huge.pdf', 99, 5)],
    ['compiled artifact', readPlaceholder.compiledArtifactTooLarge('app.js', 99, 5)],
  ])('fails the read when a %s exceeds its size limit', async (_kind, placeholder) => {
    const vfs = makeVfs()
    vfs.readFileContent.mockResolvedValue(placeholder)
    getOrMaterializeVFS.mockResolvedValue(vfs)

    const result = await executeVfsRead(
      { path: 'files/huge/content' },
      { userId: 'user-1', workflowId: 'wf-1', workspaceId: 'ws-1' }
    )

    expect(result.success).toBe(false)
    // The placeholder verbatim, not the generic "grep this instead" fallback.
    expect(result.error).toBe(placeholder.content)
  })

  it('still fails the read when the stored name contains a newline', async () => {
    // Nothing about the message text decides this, so a name that would break a
    // text-shape match cannot hide a refusal.
    const vfs = makeVfs()
    const placeholder = readPlaceholder.fileTooLarge('we\nird.txt', 99, 5)
    vfs.readFileContent.mockResolvedValue(placeholder)
    getOrMaterializeVFS.mockResolvedValue(vfs)

    const result = await executeVfsRead(
      { path: 'files/weird/content' },
      { userId: 'user-1', workflowId: 'wf-1', workspaceId: 'ws-1' }
    )

    expect(result.success).toBe(false)
    expect(result.error).toBe(placeholder.content)
  })

  it('returns a real file whose content is exactly a size-refusal message', async () => {
    // Untagged, so it is content. Recognising refusals by their text would turn this
    // user's file into a tool error instead of returning it.
    const vfs = makeVfs()
    const { content } = readPlaceholder.documentTooLarge('huge.pdf', 99, 5)
    vfs.readFileContent.mockResolvedValue({ content, totalLines: 1 })
    getOrMaterializeVFS.mockResolvedValue(vfs)

    const result = await executeVfsRead(
      { path: 'files/notes.md/content' },
      { userId: 'user-1', workflowId: 'wf-1', workspaceId: 'ws-1' }
    )

    expect(result.success).toBe(true)
    expect((result.output as { content?: string })?.content).toBe(content)
  })

  it('returns an undecodable image placeholder as content, not as a size failure', async () => {
    const vfs = makeVfs()
    // Not a size problem — the bytes were read fine and the reason is already in the
    // message, so the model should see it rather than a "too large, use grep" error.
    const placeholder = readPlaceholder.imageUnavailable(
      'bomb.png',
      90,
      'It is too large to decode safely.'
    )
    const content = placeholder.content
    vfs.readFileContent.mockResolvedValue(placeholder)
    getOrMaterializeVFS.mockResolvedValue(vfs)

    const result = await executeVfsRead(
      { path: 'files/bomb.png/content' },
      { userId: 'user-1', workflowId: 'wf-1', workspaceId: 'ws-1' }
    )

    expect(result.success).toBe(true)
    expect((result.output as { content?: string })?.content).toBe(content)
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

  it('materializes VFS reads with the request secret policy', async () => {
    const vfs = makeVfs()
    vfs.read.mockReturnValue({ content: '{}', totalLines: 1 })
    getOrMaterializeVFS.mockResolvedValue(vfs)
    const secretMountPolicy = {
      secretScope: 'selected' as const,
      mountedSecrets: ['VISIBLE_KEY'],
    }

    const result = await executeVfsRead(
      { path: 'environment/variables.json' },
      { ...GREP_CTX, secretMountPolicy }
    )

    expect(result.success).toBe(true)
    expect(getOrMaterializeVFS).toHaveBeenCalledWith('ws-1', 'user-1', {
      secretMountPolicy,
    })
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

  it('marks a windowed read as a derived provenance view', async () => {
    const vfs = makeVfs()
    vfs.readFileContentWithProvenance.mockResolvedValue({
      value: { content: 'hidden-secret\nvisible line', totalLines: 2 },
      file: { fileId: 'file-1', key: 'workspace/key-1', context: 'workspace' },
    })
    getOrMaterializeVFS.mockResolvedValue(vfs)

    const result = await executeVfsRead(
      { path: 'files/report.txt/content', offset: 1, limit: 1 },
      GREP_CTX
    )

    expect(result.success).toBe(true)
    expect(importWorkspaceFileSecretProvenanceForModelView).toHaveBeenCalledWith(
      expect.objectContaining({
        identity: { fileId: 'file-1', key: 'workspace/key-1', context: 'workspace' },
        view: 'derived',
      })
    )
  })

  it('windows against the real line count when a read under-reports totalLines', async () => {
    const vfs = makeVfs()
    vfs.readFileContentWithProvenance.mockResolvedValue({
      // `/extract` synthesizes a whole extracted document but reports totalLines: 1.
      value: { content: 'page one\npage two\npage three', totalLines: 1 },
      file: { fileId: 'file-1', key: 'workspace/key-1', context: 'workspace' },
    })
    getOrMaterializeVFS.mockResolvedValue(vfs)

    const result = await executeVfsRead(
      { path: 'files/report.pdf/extract', offset: 1, limit: 2 },
      GREP_CTX
    )

    expect(result.success).toBe(true)
    expect(result.output).toEqual({ content: 'page two\npage three', totalLines: 1 })
  })

  it('leaves an attachment read unwindowed so its label is never blanked', async () => {
    const vfs = makeVfs()
    const imageResult = {
      content: 'Image: photo.jpeg (157.0KB, image/jpeg, resized for vision)',
      totalLines: 1,
      attachment: {
        type: 'image',
        name: 'photo.jpeg',
        source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' },
      },
    }
    vfs.readFileContentWithProvenance.mockResolvedValue({
      value: imageResult,
      file: { fileId: 'file-1', key: 'workspace/key-1', context: 'workspace' },
    })
    getOrMaterializeVFS.mockResolvedValue(vfs)

    const result = await executeVfsRead(
      { path: 'files/photo.jpeg/content', offset: 1, limit: 100 },
      GREP_CTX
    )

    expect(result.success).toBe(true)
    expect(result.output).toEqual(imageResult)
  })

  it('checks every compiled-document contributor at the opaque model boundary', async () => {
    const vfs = makeVfs()
    const contentUpdatedAt = new Date('2026-08-06T00:00:00.000Z')
    vfs.readFileContentWithProvenance.mockResolvedValue({
      value: {
        content: 'Compiled file: report.pdf',
        totalLines: 1,
        attachment: {
          type: 'file',
          name: 'report.pdf',
          source: { type: 'base64', media_type: 'application/pdf', data: 'AAAA' },
        },
      },
      file: { fileId: 'source-1', key: 'workspace/source-1', context: 'workspace' },
      contributingFiles: [
        {
          fileId: 'image-1',
          key: 'workspace/image-1',
          context: 'workspace',
          contentUpdatedAt,
        },
      ],
    })
    getOrMaterializeVFS.mockResolvedValue(vfs)
    importWorkspaceFileSecretProvenanceForModelView
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)

    const result = await executeVfsRead({ path: 'files/report.pdf/compiled' }, GREP_CTX)

    expect(result.success).toBe(false)
    expect(result.error).toContain('cannot be shared safely')
    expect(importWorkspaceFileSecretProvenanceForModelView).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        identity: { fileId: 'source-1', key: 'workspace/source-1', context: 'workspace' },
        view: 'opaque',
      })
    )
    expect(importWorkspaceFileSecretProvenanceForModelView).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        identity: {
          fileId: 'image-1',
          key: 'workspace/image-1',
          context: 'workspace',
          contentUpdatedAt,
        },
        view: 'opaque',
      })
    )
  })

  it('uses the source-declared view for an unwindowed read', async () => {
    const vfs = makeVfs()
    vfs.readFileContentWithProvenance.mockResolvedValue({
      value: { content: 'complete content', totalLines: 1 },
      file: { fileId: 'file-1', key: 'workspace/key-1', context: 'workspace' },
      view: 'complete',
    })
    getOrMaterializeVFS.mockResolvedValue(vfs)

    const result = await executeVfsRead({ path: 'files/report.txt/content' }, GREP_CTX)

    expect(result.success).toBe(true)
    expect(importWorkspaceFileSecretProvenanceForModelView).toHaveBeenCalledWith(
      expect.objectContaining({ view: 'complete' })
    )
  })

  it('rejects only the file read when durable provenance cannot be verified', async () => {
    const vfs = makeVfs()
    vfs.readFileContentWithProvenance.mockResolvedValue({
      value: { content: 'content', totalLines: 1 },
      file: { fileId: 'file-1', key: 'workspace/key-1', context: 'workspace' },
    })
    getOrMaterializeVFS.mockResolvedValue(vfs)
    importWorkspaceFileSecretProvenanceForModelView.mockResolvedValueOnce(false)

    const result = await executeVfsRead({ path: 'files/report.txt/content' }, GREP_CTX)

    expect(result.success).toBe(false)
    expect(result.error).toContain('cannot be shared safely')
  })
})

describe('vfs grep workspace-file routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    importWorkspaceFileSecretProvenanceForModelView.mockResolvedValue(true)
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

  it('marks content grep as a derived provenance view', async () => {
    const vfs = makeVfs()
    vfs.grepFileWithProvenance.mockResolvedValue({
      value: [{ path: 'files/report.csv', line: 2, content: 'visible hit' }],
      file: { fileId: 'file-1', key: 'workspace/key-1', context: 'workspace' },
    })
    getOrMaterializeVFS.mockResolvedValue(vfs)

    const result = await executeVfsGrep(
      { pattern: 'visible', path: 'files/report.csv', output_mode: 'content' },
      GREP_CTX
    )

    expect(result.success).toBe(true)
    expect(importWorkspaceFileSecretProvenanceForModelView).toHaveBeenCalledWith(
      expect.objectContaining({
        view: 'derived',
      })
    )
  })

  it('treats count grep as derived from file content', async () => {
    importWorkspaceFileSecretProvenanceForModelView.mockResolvedValueOnce(false)
    const vfs = makeVfs()
    vfs.grepFileWithProvenance.mockResolvedValue({
      value: [{ path: 'files/report.csv', count: 1 }],
      file: { fileId: 'file-1', key: 'workspace/key-1', context: 'workspace' },
    })
    getOrMaterializeVFS.mockResolvedValue(vfs)

    const result = await executeVfsGrep(
      { pattern: 'visible', path: 'files/report.csv', output_mode: 'count' },
      GREP_CTX
    )

    expect(result).toEqual({
      success: false,
      error:
        'This file result cannot be shared safely because its secret provenance is unavailable.',
    })
    expect(importWorkspaceFileSecretProvenanceForModelView).toHaveBeenCalledWith(
      expect.objectContaining({ view: 'derived' })
    )
  })
})

describe('vfs uploads are opt-in (like recently-deleted/)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    importWorkspaceFileSecretProvenanceForModelView.mockResolvedValue(true)
  })

  it('does not search uploads for an unscoped grep', async () => {
    const vfs = makeVfs()
    vfs.grep.mockReturnValue([])
    getOrMaterializeVFS.mockResolvedValue(vfs)

    await executeVfsGrep({ pattern: 'secret' }, GREP_CTX_CHAT)

    expect(grepChatUpload).not.toHaveBeenCalled()
    expect(vfs.grep).toHaveBeenCalledWith('secret', undefined, expect.any(Object))
  })

  it('does not search uploads for a files/ grep', async () => {
    const vfs = makeVfs()
    vfs.grepFile.mockResolvedValue([])
    getOrMaterializeVFS.mockResolvedValue(vfs)

    await executeVfsGrep({ pattern: 'secret', path: 'files/report.csv' }, GREP_CTX_CHAT)

    expect(grepChatUpload).not.toHaveBeenCalled()
  })

  it('routes an explicit uploads/<file> path to grepChatUpload', async () => {
    grepChatUpload.mockResolvedValue([{ path: 'uploads/report.json', line: 1, content: 'hit' }])

    const result = await executeVfsGrep(
      { pattern: 'hit', path: 'uploads/report.json' },
      GREP_CTX_CHAT
    )

    expect(result.success).toBe(true)
    expect(grepChatUpload).toHaveBeenCalledWith(
      'report.json',
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
    expect(grepChatUpload).not.toHaveBeenCalled()
  })

  it('errors when grepping uploads without chat context', async () => {
    const result = await executeVfsGrep({ pattern: 'x', path: 'uploads/report.json' }, GREP_CTX)

    expect(result.success).toBe(false)
    expect(result.error).toContain('No chat context')
    expect(grepChatUpload).not.toHaveBeenCalled()
  })

  it('surfaces an upload-not-found grep error verbatim', async () => {
    grepChatUpload.mockRejectedValue(
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

  it('reads an upload directly, tolerating a spurious /content suffix', async () => {
    const vfs = makeVfs()
    getOrMaterializeVFS.mockResolvedValue(vfs)
    readChatUpload.mockResolvedValue({ content: 'hello upload', totalLines: 1 })

    const bare = await executeVfsRead({ path: 'uploads/report.csv' }, GREP_CTX_CHAT)
    expect(bare.success).toBe(true)
    expect(readChatUpload).toHaveBeenLastCalledWith('report.csv', 'chat-1')

    // The model adds /content out of habit (from files/) — it must still resolve.
    const withContent = await executeVfsRead({ path: 'uploads/report.csv/content' }, GREP_CTX_CHAT)
    expect(withContent.success).toBe(true)
    expect(readChatUpload).toHaveBeenLastCalledWith('report.csv', 'chat-1')
  })

  it('tolerates a trailing /content on an uploads grep path', async () => {
    grepChatUpload.mockResolvedValue([])

    await executeVfsGrep({ pattern: 'x', path: 'uploads/report.json/content' }, GREP_CTX_CHAT)

    expect(grepChatUpload).toHaveBeenCalledWith('report.json', 'chat-1', 'x', expect.any(Object))
  })
})

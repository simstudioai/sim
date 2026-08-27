/**
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

const GREP_CTX = {
  userId: 'user-1',
  workflowId: 'wf-1',
  workspaceId: 'ws-1',
  toolCallId: 'tool-1',
  copilotToolExecution: true,
}
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

    const result = await executeVfsGrep({ pattern: 'foo', output_mode: 'content' }, GREP_CTX)

    expect(result.success).toBe(false)
    expect(result.error).toContain('more specific pattern')
    expect(result.error).toContain('context window')
  })

  it('fails oversized read results from VFS with paging guidance', async () => {
    const vfs = makeVfs()
    vfs.readFileContent.mockResolvedValue(null)
    vfs.read.mockReturnValue({ content: OVERSIZED_INLINE_CONTENT, totalLines: 1 })
    getOrMaterializeVFS.mockResolvedValue(vfs)

    const result = await executeVfsRead({ path: 'workflows/My Workflow/state.json' }, GREP_CTX)

    expect(result.success).toBe(false)
    expect(result.error).toContain('Page it')
    expect(result.error).toContain('grep')
    expect(result.error).toContain('context window')
  })

  it('pages an oversized workspace file when offset/limit are passed', async () => {
    const vfs = makeVfs()
    const lines = Array.from({ length: 5000 }, (_, i) => `line ${i} ${'y'.repeat(50)}`)
    vfs.readFileContent.mockResolvedValue({
      content: lines.join('\n'),
      totalLines: lines.length,
    })
    getOrMaterializeVFS.mockResolvedValue(vfs)

    const whole = await executeVfsRead({ path: 'files/big.log/content' }, GREP_CTX)
    expect(whole.success).toBe(false)
    expect(whole.error).toContain('Page it')

    const paged = await executeVfsRead(
      { path: 'files/big.log/content', offset: 10, limit: 5 },
      GREP_CTX
    )
    expect(paged.success).toBe(true)
    expect((paged.output as { content: string }).content).toBe(lines.slice(10, 15).join('\n'))
  })

  it('tells the model to reduce limit when the requested window is still oversized', async () => {
    const vfs = makeVfs()
    vfs.readFileContent.mockResolvedValue({
      content: Array.from({ length: 100 }, () => OVERSIZED_INLINE_CONTENT).join('\n'),
      totalLines: 100,
    })
    getOrMaterializeVFS.mockResolvedValue(vfs)

    const result = await executeVfsRead(
      { path: 'files/big.log/content', offset: 0, limit: 50 },
      GREP_CTX
    )
    expect(result.success).toBe(false)
    expect(result.error).toContain('Reduce limit')
  })

  it('notes an empty file instead of returning bare empty content', async () => {
    const vfs = makeVfs()
    vfs.readFileContent.mockResolvedValue({ content: '', totalLines: 0 })
    getOrMaterializeVFS.mockResolvedValue(vfs)

    const result = await executeVfsRead({ path: 'files/hi.txt/content' }, GREP_CTX)
    expect(result.success).toBe(true)
    expect((result.output as { note?: string }).note).toContain('empty')
  })

  it('fails file-backed oversized read placeholders with original message', async () => {
    const vfs = makeVfs()
    vfs.readFileContent.mockResolvedValue(
      readPlaceholder.fileTooLarge('big.txt', 6_000_000, 5_242_880)
    )
    getOrMaterializeVFS.mockResolvedValue(vfs)

    const result = await executeVfsRead({ path: 'files/big.txt/content' }, GREP_CTX)

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

    const result = await executeVfsRead({ path: 'files/chess.png/content' }, GREP_CTX)

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

    const result = await executeVfsRead({ path: 'files/reports/report.pdf/compiled' }, GREP_CTX)

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

    const result = await executeVfsRead({ path: 'files/huge.png/content' }, GREP_CTX)

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

    const result = await executeVfsRead({ path: 'files/weird/content' }, GREP_CTX)

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

    const result = await executeVfsRead({ path: 'files/notes.md/content' }, GREP_CTX)

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

    const result = await executeVfsRead({ path: 'files/bomb.png/content' }, GREP_CTX)

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

    const result = await executeVfsRead({ path: 'files/report.csv' }, GREP_CTX)

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
    expect(getOrMaterializeVFS).toHaveBeenCalledWith(
      'ws-1',
      'user-1',
      expect.objectContaining({
        secretMountPolicy,
        knowledgePrincipal: expect.objectContaining({
          kind: 'delegated',
          delegationId: 'tool-1',
          workspaceId: 'ws-1',
        }),
      })
    )
  })

  it('uses dynamic file reads for canonical style paths', async () => {
    const vfs = makeVfs()
    vfs.readFileContent.mockResolvedValue({
      content: '{"format":"docx"}',
      totalLines: 1,
    })
    getOrMaterializeVFS.mockResolvedValue(vfs)

    const result = await executeVfsRead({ path: 'files/reports/brief.docx/style' }, GREP_CTX)

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

    const result = await executeVfsRead({ path: 'files/reports/brief.pdf/compiled' }, GREP_CTX)

    expect(result.success).toBe(true)
    expect(vfs.readFileContent).toHaveBeenCalledWith('files/reports/brief.pdf/compiled')
    expect(vfs.read).not.toHaveBeenCalled()
  })

  it('surfaces dynamic file read errors as failed tool calls', async () => {
    const vfs = makeVfs()
    const error = 'Document compiler not configured (MOTHERSHIP_E2B_DOC_TEMPLATE_ID is unset)'
    vfs.readFileContent.mockResolvedValue({
      content: JSON.stringify({ ok: false, error }),
      totalLines: 1,
      error,
    })
    getOrMaterializeVFS.mockResolvedValue(vfs)

    const result = await executeVfsRead({ path: 'files/reports/brief.pdf/render' }, GREP_CTX)

    expect(result).toEqual({ success: false, error })
  })

  it('does not expose dynamic file read errors when provenance cannot be verified', async () => {
    const vfs = makeVfs()
    const error = 'Document compiler not configured (MOTHERSHIP_E2B_DOC_TEMPLATE_ID is unset)'
    vfs.readFileContentWithProvenance.mockResolvedValue({
      value: {
        content: JSON.stringify({ ok: false, error }),
        totalLines: 1,
        error,
      },
      file: { fileId: 'file-1', key: 'workspace/key-1', context: 'workspace' },
    })
    getOrMaterializeVFS.mockResolvedValue(vfs)
    importWorkspaceFileSecretProvenanceForModelView.mockResolvedValueOnce(false)

    const result = await executeVfsRead({ path: 'files/reports/brief.pdf/render' }, GREP_CTX)

    expect(result).toEqual({
      success: false,
      error:
        'This file result cannot be shared safely because its secret provenance is unavailable.',
    })
    expect(importWorkspaceFileSecretProvenanceForModelView).toHaveBeenCalledWith(
      expect.objectContaining({
        identity: { fileId: 'file-1', key: 'workspace/key-1', context: 'workspace' },
        view: 'derived',
      })
    )
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

  it('explains an empty uploads glob instead of returning a bare []', async () => {
    const vfs = makeVfs()
    getOrMaterializeVFS.mockResolvedValue(vfs)
    listChatUploads.mockResolvedValue([])

    const result = await executeVfsGlob({ pattern: 'uploads/*' }, GREP_CTX_CHAT)
    expect(result.success).toBe(true)
    expect((result.output as { files: string[]; note?: string }).files).toEqual([])
    expect((result.output as { note?: string }).note).toContain('no uploads')
  })

  it('explains an empty user-local glob instead of returning a bare []', async () => {
    const vfs = makeVfs()
    getOrMaterializeVFS.mockResolvedValue(vfs)

    const result = await executeVfsGlob({ pattern: 'user-local/**' }, GREP_CTX_CHAT)
    expect(result.success).toBe(true)
    expect((result.output as { note?: string }).note).toContain('user-local')
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

describe('vfs handlers docs corpus routing', () => {
  const fetchMock = vi.fn()
  const DOCS_PAGE = 'docs/workflows/blocks/agent.mdx'

  beforeEach(() => {
    vi.clearAllMocks()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('globs the docs corpus without materializing the workspace VFS', async () => {
    const result = await executeVfsGlob({ pattern: 'docs/**' }, GREP_CTX)

    expect(result.success).toBe(true)
    expect((result.output as { files: string[] }).files).toContain(DOCS_PAGE)
    expect(getOrMaterializeVFS).not.toHaveBeenCalled()
  })

  it('reads a docs page via the live-site fetch, not the workspace VFS', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => 'line one\nline two',
    })

    const result = await executeVfsRead({ path: DOCS_PAGE }, GREP_CTX)

    expect(result.success).toBe(true)
    expect(result.output).toEqual({ content: 'line one\nline two', totalLines: 2 })
    expect(getOrMaterializeVFS).not.toHaveBeenCalled()
  })

  it('surfaces DocsCorpusError messages verbatim from read, without fetching', async () => {
    const unknown = await executeVfsRead({ path: 'docs/not-a-real-page.mdx' }, GREP_CTX)
    expect(unknown.success).toBe(false)
    expect(unknown.error).toContain('Docs page not found')

    const dir = await executeVfsRead({ path: 'docs/workflows/blocks' }, GREP_CTX)
    expect(dir.success).toBe(false)
    expect(dir.error).toContain('is a directory')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('greps one docs page and rejects directory scope without touching the workspace VFS', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => 'alpha\ncron beta\ngamma',
    })

    const single = await executeVfsGrep({ pattern: 'cron', path: DOCS_PAGE }, GREP_CTX)
    expect(single.success).toBe(true)

    const directory = await executeVfsGrep(
      { pattern: 'cron', path: 'docs/workflows', maxResults: 10_000 },
      GREP_CTX
    )
    expect(directory.success).toBe(false)
    expect(directory.error).toContain('grep must target one docs page')
    expect(fetchMock).toHaveBeenCalledOnce()

    const invalid = await executeVfsGrep({ pattern: 'cron', path: 'docs/not-a-page.mdx' }, GREP_CTX)
    expect(invalid.success).toBe(false)
    expect(invalid.error).toContain('not a docs page')
    expect(getOrMaterializeVFS).not.toHaveBeenCalled()
  })

  it('truncates an oversized multi-line docs page to fit the inline cap', async () => {
    const line = 'y'.repeat(200)
    const totalLines = Math.ceil((TOOL_RESULT_MAX_INLINE_CHARS * 2) / (line.length + 1))
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => Array.from({ length: totalLines }, () => line).join('\n'),
    })

    const result = await executeVfsRead({ path: DOCS_PAGE }, GREP_CTX)

    expect(result.success).toBe(true)
    const output = result.output as { content: string; totalLines: number }
    expect(output.totalLines).toBe(totalLines)
    expect(output.content).toContain('[Page truncated: returned lines 1-')
    expect(output.content).toMatch(/offset: \d+ and limit: \d+/)
    expect(output.content).toContain('reduce the limit if that window is still too large')
    expect(JSON.stringify(output).length).toBeLessThanOrEqual(TOOL_RESULT_MAX_INLINE_CHARS)
  })

  it('fails a docs page whose single line cannot fit inline instead of returning it oversized', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => 'z'.repeat(TOOL_RESULT_MAX_INLINE_CHARS + 1000),
    })

    const result = await executeVfsRead({ path: DOCS_PAGE }, GREP_CTX)

    expect(result.success).toBe(false)
    expect(result.error).toContain('Grep this page')
  })

  it('rejects an explicit window that still overflows instead of truncating it', async () => {
    const line = 'y'.repeat(200)
    const totalLines = Math.ceil((TOOL_RESULT_MAX_INLINE_CHARS * 2) / (line.length + 1))
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => Array.from({ length: totalLines }, () => line).join('\n'),
    })

    const result = await executeVfsRead({ path: DOCS_PAGE, offset: 0, limit: totalLines }, GREP_CTX)

    expect(result.success).toBe(false)
    expect(result.error).toContain('still too large over the requested window')
  })

  it('forwards caller cancellation to docs read and grep without fetching', async () => {
    const controller = new AbortController()
    controller.abort(new Error('user stopped docs tool'))
    const context = { ...GREP_CTX, abortSignal: controller.signal }

    const read = await executeVfsRead({ path: DOCS_PAGE }, context)
    const grep = await executeVfsGrep({ pattern: 'agent', path: DOCS_PAGE }, context)

    expect(read).toEqual({ success: false, error: 'user stopped docs tool' })
    expect(grep).toEqual({ success: false, error: 'user stopped docs tool' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

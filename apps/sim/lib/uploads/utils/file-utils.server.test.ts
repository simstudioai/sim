/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDownloadFile, mockResolveServableDocBytes } = vi.hoisted(() => ({
  mockDownloadFile: vi.fn(),
  mockResolveServableDocBytes: vi.fn(),
}))

vi.mock('@/lib/uploads/core/storage-service', () => ({
  downloadFile: mockDownloadFile,
  hasCloudStorage: vi.fn(() => true),
}))

vi.mock('@/app/api/files/authorization', () => ({
  verifyFileAccess: vi.fn(),
}))

vi.mock('@/lib/copilot/tools/server/files/doc-compile', () => ({
  resolveServableDocBytes: mockResolveServableDocBytes,
}))

import { createLogger } from '@sim/logger'
import {
  downloadFileFromStorage,
  downloadServableFileFromStorage,
} from '@/lib/uploads/utils/file-utils.server'
import type { UserFile } from '@/executor/types'

describe('downloadFileFromStorage context derivation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDownloadFile.mockResolvedValue(Buffer.from('bytes'))
  })

  it('downloads with the key-derived context, ignoring a caller-supplied public context', async () => {
    const userFile: UserFile = {
      id: 'f1',
      name: 'report.pdf',
      url: '',
      size: 5,
      type: 'application/pdf',
      key: 'workspace/ws-1/1700000000000-abc1234-report.pdf',
      context: 'og-images',
    }

    await downloadFileFromStorage(userFile, 'req-1', createLogger('test'))

    expect(mockDownloadFile).toHaveBeenCalledTimes(1)
    expect(mockDownloadFile).toHaveBeenCalledWith(
      expect.objectContaining({ key: userFile.key, context: 'workspace' })
    )
  })
})

describe('downloadServableFileFromStorage generated-doc gating', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDownloadFile.mockResolvedValue(Buffer.from('raw source bytes'))
    mockResolveServableDocBytes.mockResolvedValue({
      buffer: Buffer.from('%PDF-1.4 rendered'),
      contentType: 'application/pdf',
    })
  })

  it('resolves via the compiled-artifact path when the type is a generation-source marker, even if the name extension is not renderable', async () => {
    // Regression test: the pre-filter used to gate solely on `isRenderableDocumentName(name)`,
    // so a UserFile.name edited from report.docx to report.doc (still carrying its real
    // generation-source type) never even reached the resolver. This test pins the gate
    // only — the real resolver is extension-keyed (COMPILABLE_FORMATS), so a rename to a
    // non-compilable extension still passes source through at that layer; routing here is
    // necessary, not sufficient.
    const userFile: UserFile = {
      id: 'f1',
      name: 'report.doc',
      url: '',
      size: 5,
      type: 'text/x-python-pdf',
      key: 'workspace/ws-1/1700000000000-abc1234-report.doc',
    }

    const result = await downloadServableFileFromStorage(userFile, 'req-1', createLogger('test'))

    expect(mockResolveServableDocBytes).toHaveBeenCalledTimes(1)
    expect(mockResolveServableDocBytes).toHaveBeenCalledWith(
      expect.objectContaining({ isGeneratedSource: true })
    )
    expect(result).toEqual({
      buffer: Buffer.from('%PDF-1.4 rendered'),
      contentType: 'application/pdf',
    })
  })

  it('passes a file through unchanged when neither its type nor its name suggests a generated doc', async () => {
    const userFile: UserFile = {
      id: 'f2',
      name: 'notes.csv',
      url: '',
      size: 5,
      type: 'text/csv',
      key: 'workspace/ws-1/1700000000000-abc1234-notes.csv',
    }

    const result = await downloadServableFileFromStorage(userFile, 'req-1', createLogger('test'))

    expect(mockResolveServableDocBytes).not.toHaveBeenCalled()
    expect(result).toEqual({
      buffer: Buffer.from('raw source bytes'),
      contentType: 'text/csv',
    })
  })

  it('still consults the resolver when a renderable-named file declares a real (non-marker) MIME type', async () => {
    // Regression test: the gate must not trust a declared "application/pdf" to skip
    // resolution — UserFile.type is workflow-state data, and a caller (a mothership
    // edit_workflow op, a function block rebuilding the object) that cannot know the
    // internal text/x-python-pdf marker will naturally write the real MIME instead.
    // The resolver's magic-byte check on the stored bytes is the only trustworthy
    // signal; real PDFs short-circuit there, source text gets its compiled artifact.
    const userFile: UserFile = {
      id: 'f4',
      name: 'report.pdf',
      url: '',
      size: 5,
      type: 'application/pdf',
      key: 'workspace/ws-1/1700000000000-abc1234-report.pdf',
    }

    const result = await downloadServableFileFromStorage(userFile, 'req-1', createLogger('test'))

    expect(mockResolveServableDocBytes).toHaveBeenCalledTimes(1)
    // The declared MIME is real, so the resolver is told this is NOT generation
    // source — it still runs (a marker-less generated doc is rescued by the
    // artifact lookup), but it will not report a never-ending compile or hand
    // these bytes to the sandbox on the strength of the name alone.
    expect(mockResolveServableDocBytes).toHaveBeenCalledWith(
      expect.objectContaining({ isGeneratedSource: false })
    )
    expect(result).toEqual({
      buffer: Buffer.from('%PDF-1.4 rendered'),
      contentType: 'application/pdf',
    })
  })

  it('falls back to name-based gating when no type is set', async () => {
    const userFile: UserFile = {
      id: 'f3',
      name: 'report.pdf',
      url: '',
      size: 5,
      type: '',
      key: 'workspace/ws-1/1700000000000-abc1234-report.pdf',
    }

    await downloadServableFileFromStorage(userFile, 'req-1', createLogger('test'))

    expect(mockResolveServableDocBytes).toHaveBeenCalledTimes(1)
    // Only a marker is evidence. An empty type carries none, so the resolver is told
    // there is no positive evidence and falls back to the artifact store to decide.
    expect(mockResolveServableDocBytes).toHaveBeenCalledWith(
      expect.objectContaining({ isGeneratedSource: false })
    )
  })

  it('refuses unrendered bytes rather than handing them to a caller that expects the document', async () => {
    // ~45 call sites (email attachments, cloud uploads, zip entries, provider
    // attachments) receive only a Buffer and re-infer the type from the filename, so
    // an opt-in flag would be silently ignored by all of them. Failing here is what
    // keeps generation source from going out under a .pdf.
    mockResolveServableDocBytes.mockResolvedValue({
      buffer: Buffer.from('<html>not a pdf</html>'),
      contentType: 'application/octet-stream',
      unrendered: true,
    })
    const userFile: UserFile = {
      id: 'f7',
      name: 'report.pdf',
      url: '',
      size: 5,
      type: 'text/x-python-pdf',
      key: 'workspace/ws-1/1700000000000-abc1234-report.pdf',
    }

    await expect(
      downloadServableFileFromStorage(userFile, 'req-1', createLogger('test'))
    ).rejects.toThrow(/could not be rendered/)
  })

  it('does not mistake the generic octet-stream fallback for a real declared type', async () => {
    // convertToUserFile emits application/octet-stream for a type-less input, so this
    // value carries no information about whether the bytes are generation source.
    const userFile: UserFile = {
      id: 'f5',
      name: 'report.pdf',
      url: '',
      size: 5,
      type: 'application/octet-stream',
      key: 'workspace/ws-1/1700000000000-abc1234-report.pdf',
    }

    await downloadServableFileFromStorage(userFile, 'req-1', createLogger('test'))

    expect(mockResolveServableDocBytes).toHaveBeenCalledWith(
      expect.objectContaining({ isGeneratedSource: false })
    )
  })

  it('recognizes a generation-source marker regardless of casing or padding', async () => {
    const userFile: UserFile = {
      id: 'f6',
      name: 'report.pdf',
      url: '',
      size: 5,
      type: '  TEXT/X-PYTHON-PDF  ',
      key: 'workspace/ws-1/1700000000000-abc1234-report.pdf',
    }

    await downloadServableFileFromStorage(userFile, 'req-1', createLogger('test'))

    expect(mockResolveServableDocBytes).toHaveBeenCalledWith(
      expect.objectContaining({ isGeneratedSource: true })
    )
  })
})

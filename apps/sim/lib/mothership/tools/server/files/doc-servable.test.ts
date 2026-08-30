/**
 * @vitest-environment node
 */
import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockExecuteInSandbox,
  mockLoadCompiledDoc,
  mockLoadPublishedCompiledDoc,
  mockPublishCompiledDocArtifact,
  mockReadWorkspaceFileContent,
  mockReadWorkspaceFileMetadata,
  mockRunSandboxTask,
  mockStoreCompiledDoc,
} = vi.hoisted(() => ({
  mockExecuteInSandbox: vi.fn(),
  mockLoadCompiledDoc: vi.fn(),
  mockLoadPublishedCompiledDoc: vi.fn(),
  mockPublishCompiledDocArtifact: vi.fn(),
  mockReadWorkspaceFileContent: vi.fn(),
  mockReadWorkspaceFileMetadata: vi.fn(),
  mockRunSandboxTask: vi.fn(),
  mockStoreCompiledDoc: vi.fn(),
}))

vi.mock('@/lib/execution/remote-sandbox', () => ({
  executeInSandbox: mockExecuteInSandbox,
  executeShellInSandbox: vi.fn(),
}))
vi.mock('@/lib/execution/languages', () => ({
  CodeLanguage: { javascript: 'javascript', python: 'python' },
}))
vi.mock('@/lib/execution/sandbox/run-task', () => ({
  runSandboxTask: mockRunSandboxTask,
}))
vi.mock('@/lib/workspace-files/application/read-workspace-file-content', () => ({
  readWorkspaceFileContent: { execute: mockReadWorkspaceFileContent },
}))
vi.mock('@/lib/workspace-files/application/read-workspace-file-metadata', () => ({
  readWorkspaceFileMetadata: { execute: mockReadWorkspaceFileMetadata },
}))
vi.mock('./doc-compiled-store', () => ({
  loadCompiledDoc: mockLoadCompiledDoc,
  loadPublishedCompiledDoc: mockLoadPublishedCompiledDoc,
  publishCompiledDocArtifact: mockPublishCompiledDocArtifact,
  storeCompiledDoc: mockStoreCompiledDoc,
}))
vi.mock('@/app/api/files/utils', () => ({
  getContentType: (name: string) =>
    name.endsWith('.pdf')
      ? 'application/pdf'
      : name.endsWith('.txt')
        ? 'text/plain'
        : 'application/octet-stream',
}))

import { DocCompileUserError } from '@/lib/mothership/tools/server/files/doc-compile-error'
import { compileDoc, resolveServableDoc, resolveServableDocBytes } from './doc-compile'

const WORKSPACE_ID = '550e8400-e29b-41d4-a716-446655440000'
const FILE_PRINCIPAL = { kind: 'session', userId: 'user-1' } as const
const PDF_MAGIC = Buffer.from('%PDF-1.7\n...binary...')
const PDF_SOURCE = Buffer.from('from reportlab.pdfgen import canvas\n# generates a PDF', 'utf-8')
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01])
const XLSX_SOURCE = Buffer.from('from openpyxl import Workbook\n# generates an xlsx', 'utf-8')

function referencedFileSource(count: number): Buffer {
  return Buffer.from(
    Array.from({ length: count }, (_, index) => `getFileBase64('file-${index}')`).join('\n'),
    'utf-8'
  )
}

afterAll(resetEnvFlagsMock)

describe('resolveServableDocBytes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setEnvFlags({ isDocSandboxEnabled: true })
    mockLoadPublishedCompiledDoc.mockResolvedValue(null)
  })

  it('swaps generated-doc source for the compiled artifact + binary content type', async () => {
    const artifact = Buffer.from('%PDF-compiled-binary')
    mockLoadCompiledDoc.mockResolvedValue(artifact)

    const result = await resolveServableDocBytes({
      rawBuffer: PDF_SOURCE,
      fileName: 'report.pdf',
      workspaceId: WORKSPACE_ID,
    })

    expect(result.buffer).toBe(artifact)
    expect(result.contentType).toBe('application/pdf')
    expect(mockLoadCompiledDoc).toHaveBeenCalledWith(
      WORKSPACE_ID,
      PDF_SOURCE.toString('utf-8'),
      'pdf'
    )
    expect(mockLoadCompiledDoc).toHaveBeenCalledTimes(1)
  })

  it('passes through a real binary PDF (carries the %PDF magic) without an artifact lookup', async () => {
    const result = await resolveServableDocBytes({
      rawBuffer: PDF_MAGIC,
      fileName: 'uploaded.pdf',
      workspaceId: WORKSPACE_ID,
    })

    expect(result.buffer).toBe(PDF_MAGIC)
    expect(result.contentType).toBe('application/pdf')
    expect(mockLoadCompiledDoc).not.toHaveBeenCalled()
  })

  it('checks a missing no-reference public artifact only once', async () => {
    mockLoadCompiledDoc.mockResolvedValue(null)

    await expect(resolveServableDoc(WORKSPACE_ID, PDF_SOURCE, 'report.pdf')).resolves.toEqual({
      kind: 'unavailable',
    })
    expect(mockLoadCompiledDoc).toHaveBeenCalledTimes(1)
    expect(mockLoadCompiledDoc).toHaveBeenCalledWith(
      WORKSPACE_ID,
      PDF_SOURCE.toString('utf-8'),
      'pdf'
    )
  })

  it('lazily rebuilds a legacy referenced-file document under its dependency-bound key', async () => {
    const source = Buffer.from(`image = await getFileBase64('reference-1')`, 'utf-8')
    const contentUpdatedAt = new Date('2026-08-05T01:00:00.000Z')
    const record = {
      id: 'reference-1',
      workspaceId: WORKSPACE_ID,
      name: 'reference.png',
      key: `workspace/${WORKSPACE_ID}/reference.png`,
      path: '/api/files/serve/reference.png',
      size: 10,
      type: 'image/png',
      uploadedBy: 'user-1',
      uploadedAt: contentUpdatedAt,
      updatedAt: contentUpdatedAt,
      contentUpdatedAt,
      storageContext: 'workspace' as const,
    }
    mockReadWorkspaceFileMetadata.mockResolvedValue({ file: record, share: null })
    mockLoadCompiledDoc.mockResolvedValue(null)
    mockReadWorkspaceFileContent.mockResolvedValue({
      file: record,
      content: Buffer.from('image-bytes'),
    })
    mockExecuteInSandbox.mockResolvedValue({
      exportedFileContent: Buffer.from('%PDF-rebuilt').toString('base64'),
    })

    const result = await resolveServableDocBytes({
      rawBuffer: source,
      fileName: 'report.pdf',
      workspaceId: WORKSPACE_ID,
      filePrincipal: FILE_PRINCIPAL,
    })

    expect(result).toEqual({
      buffer: Buffer.from('%PDF-rebuilt'),
      contentType: 'application/pdf',
      contributingFiles: [
        {
          fileId: 'reference-1',
          key: `workspace/${WORKSPACE_ID}/reference.png`,
          context: 'workspace',
          contentUpdatedAt,
        },
      ],
    })
    expect(mockReadWorkspaceFileContent).toHaveBeenCalledWith({
      principal: FILE_PRINCIPAL,
      input: {
        fileId: 'reference-1',
        assertedWorkspaceId: WORKSPACE_ID,
        maxBytes: 25 * 1024 * 1024,
      },
    })
    expect(mockExecuteInSandbox).toHaveBeenCalledTimes(1)
    expect(mockStoreCompiledDoc).toHaveBeenCalledWith(
      WORKSPACE_ID,
      source.toString('utf-8'),
      'pdf',
      'application/pdf',
      Buffer.from('%PDF-rebuilt'),
      expect.stringContaining('reference-1')
    )
  })

  it('keeps an existing public referenced document available through its legacy artifact', async () => {
    const source = Buffer.from(`image = await getFileBase64('reference-1')`, 'utf-8')
    const legacyArtifact = Buffer.from('%PDF-legacy')
    mockLoadCompiledDoc.mockResolvedValue(legacyArtifact)

    await expect(resolveServableDoc(WORKSPACE_ID, source, 'report.pdf')).resolves.toEqual({
      kind: 'artifact',
      buffer: legacyArtifact,
      contentType: 'application/pdf',
    })
    expect(mockLoadCompiledDoc).toHaveBeenCalledWith(WORKSPACE_ID, source.toString('utf-8'), 'pdf')
    expect(mockReadWorkspaceFileMetadata).not.toHaveBeenCalled()
    expect(mockExecuteInSandbox).not.toHaveBeenCalled()
    expect(mockStoreCompiledDoc).not.toHaveBeenCalled()
  })

  it('serves the dependency-bound artifact published by an authorized compile', async () => {
    const source = Buffer.from(`image = await getFileBase64('reference-1')`, 'utf-8')
    const publishedArtifact = Buffer.from('%PDF-published')
    mockLoadPublishedCompiledDoc.mockResolvedValue(publishedArtifact)

    await expect(resolveServableDoc(WORKSPACE_ID, source, 'report.pdf')).resolves.toEqual({
      kind: 'artifact',
      buffer: publishedArtifact,
      contentType: 'application/pdf',
    })
    expect(mockLoadPublishedCompiledDoc).toHaveBeenCalledWith(
      WORKSPACE_ID,
      source.toString('utf-8'),
      'pdf'
    )
    expect(mockLoadCompiledDoc).not.toHaveBeenCalled()
    expect(mockReadWorkspaceFileMetadata).not.toHaveBeenCalled()
  })

  it('fails fast when a private referenced document loses its Principal', async () => {
    const source = Buffer.from(`image = await getFileBase64('reference-1')`, 'utf-8')

    await expect(
      resolveServableDocBytes({
        rawBuffer: source,
        fileName: 'report.pdf',
        workspaceId: WORKSPACE_ID,
      })
    ).rejects.toThrow(
      'Referenced document resolution requires an authorized workspace file principal'
    )
    expect(mockLoadPublishedCompiledDoc).toHaveBeenCalledWith(
      WORKSPACE_ID,
      source.toString('utf-8'),
      'pdf'
    )
    expect(mockLoadCompiledDoc).not.toHaveBeenCalled()
  })

  it('lets a principal-less private adapter use output published by an authorized compile', async () => {
    const source = Buffer.from(`image = await getFileBase64('reference-1')`, 'utf-8')
    const publishedArtifact = Buffer.from('%PDF-published')
    mockLoadPublishedCompiledDoc.mockResolvedValue(publishedArtifact)

    await expect(
      resolveServableDocBytes({
        rawBuffer: source,
        fileName: 'report.pdf',
        workspaceId: WORKSPACE_ID,
      })
    ).resolves.toEqual({
      buffer: publishedArtifact,
      contentType: 'application/pdf',
    })
    expect(mockReadWorkspaceFileMetadata).not.toHaveBeenCalled()
    expect(mockReadWorkspaceFileContent).not.toHaveBeenCalled()
    expect(mockLoadCompiledDoc).not.toHaveBeenCalled()
  })

  it('does not apply model-only provenance policy while serving a public legacy artifact', async () => {
    const source = Buffer.from(`image = await getFileBase64('reference-1')`, 'utf-8')
    const legacyArtifact = Buffer.from('%PDF-legacy')
    mockLoadCompiledDoc.mockResolvedValue(legacyArtifact)

    await expect(resolveServableDoc(WORKSPACE_ID, source, 'report.pdf')).resolves.toEqual({
      kind: 'artifact',
      buffer: legacyArtifact,
      contentType: 'application/pdf',
    })
    expect(mockLoadCompiledDoc).toHaveBeenCalledTimes(1)
    expect(mockReadWorkspaceFileMetadata).not.toHaveBeenCalled()
    expect(mockExecuteInSandbox).not.toHaveBeenCalled()
  })

  it('does not resolve referenced files for a public legacy artifact', async () => {
    const source = Buffer.from(`image = await getFileBase64('reference-1')`, 'utf-8')
    const legacyArtifact = Buffer.from('%PDF-legacy')
    mockLoadCompiledDoc.mockResolvedValue(legacyArtifact)

    await expect(resolveServableDoc(WORKSPACE_ID, source, 'report.pdf')).resolves.toEqual({
      kind: 'artifact',
      buffer: legacyArtifact,
      contentType: 'application/pdf',
    })
    expect(mockReadWorkspaceFileMetadata).not.toHaveBeenCalled()
    expect(mockReadWorkspaceFileContent).not.toHaveBeenCalled()
  })

  it('serves a legacy artifact with more than 20 references without resolving files', async () => {
    const source = referencedFileSource(21)
    const legacyArtifact = Buffer.from('%PDF-legacy')
    mockLoadCompiledDoc.mockResolvedValue(legacyArtifact)

    await expect(resolveServableDoc(WORKSPACE_ID, source, 'report.pdf')).resolves.toEqual({
      kind: 'artifact',
      buffer: legacyArtifact,
      contentType: 'application/pdf',
    })
    expect(mockReadWorkspaceFileMetadata).not.toHaveBeenCalled()
    expect(mockLoadCompiledDoc).toHaveBeenCalledWith(WORKSPACE_ID, source.toString('utf-8'), 'pdf')
    expect(mockExecuteInSandbox).not.toHaveBeenCalled()
  })

  it('throws DocCompileUserError when a generated doc artifact is not ready (E2B regime)', async () => {
    mockLoadCompiledDoc.mockResolvedValue(null)
    setEnvFlags({ isDocSandboxEnabled: true })

    await expect(
      resolveServableDocBytes({
        rawBuffer: PDF_SOURCE,
        fileName: 'report.pdf',
        workspaceId: WORKSPACE_ID,
      })
    ).rejects.toBeInstanceOf(DocCompileUserError)

    expect(mockRunSandboxTask).not.toHaveBeenCalled()
  })

  it('compiles via the sandbox when E2B is disabled and no artifact is stored', async () => {
    mockLoadCompiledDoc.mockResolvedValue(null)
    setEnvFlags({ isDocSandboxEnabled: false })
    const compiled = Buffer.from('%PDF-isolated-vm-binary')
    mockRunSandboxTask.mockResolvedValue(compiled)

    const result = await resolveServableDocBytes({
      rawBuffer: PDF_SOURCE,
      fileName: 'report.pdf',
      workspaceId: WORKSPACE_ID,
    })

    expect(result.buffer).toBe(compiled)
    expect(result.contentType).toBe('application/pdf')
    expect(mockRunSandboxTask).toHaveBeenCalledWith(
      'pdf-generate',
      { code: PDF_SOURCE.toString('utf-8'), workspaceId: WORKSPACE_ID },
      expect.objectContaining({})
    )
  })

  it('does not couple isolated-vm compile success to durable artifact storage', async () => {
    mockLoadCompiledDoc.mockResolvedValue(null)
    setEnvFlags({ isDocSandboxEnabled: false })
    const compiled = Buffer.from('%PDF-isolated-vm-binary')
    mockRunSandboxTask.mockResolvedValue(compiled)

    await expect(
      resolveServableDocBytes({
        rawBuffer: PDF_SOURCE,
        fileName: 'report.pdf',
        workspaceId: WORKSPACE_ID,
      })
    ).resolves.toEqual({ buffer: compiled, contentType: 'application/pdf' })
    expect(mockLoadCompiledDoc).not.toHaveBeenCalled()
    expect(mockStoreCompiledDoc).not.toHaveBeenCalled()
  })

  it('preserves contributor identities when a servable document hits the local compile cache', async () => {
    const source = 'const cacheContributor = true'
    const compiled = Buffer.from('%PDF-cached-with-contributor')
    const contentUpdatedAt = new Date('2026-08-06T01:00:00.000Z')
    const contributor = {
      fileId: 'reference-cache-1',
      key: 'workspace/workspace-1/reference-cache-1.png',
      context: 'workspace' as const,
      contentUpdatedAt,
    }
    setEnvFlags({ isDocSandboxEnabled: false })
    mockRunSandboxTask.mockImplementationOnce((...args: unknown[]) => {
      const options = args[2] as {
        onWorkspaceFileAccess?: (identity: typeof contributor) => void
      }
      options.onWorkspaceFileAccess?.(contributor)
      return Promise.resolve(compiled)
    })

    await expect(
      compileDoc({
        source,
        fileName: 'report.pdf',
        workspaceId: '',
        filePrincipal: FILE_PRINCIPAL,
      })
    ).resolves.toEqual({
      buffer: compiled,
      contentType: 'application/pdf',
      contributingFiles: [contributor],
    })

    await expect(
      resolveServableDocBytes({
        rawBuffer: Buffer.from(source),
        fileName: 'report.pdf',
        workspaceId: undefined,
      })
    ).resolves.toEqual({
      buffer: compiled,
      contentType: 'application/pdf',
      contributingFiles: [contributor],
    })
    expect(mockRunSandboxTask).toHaveBeenCalledTimes(1)
  })

  it('keeps the isolated-vm fallback for referenced documents when E2B is disabled', async () => {
    const source = Buffer.from(`const image = getFileBase64('reference-1')`, 'utf-8')
    setEnvFlags({ isDocSandboxEnabled: false })
    mockLoadCompiledDoc.mockResolvedValue(null)
    const compiled = Buffer.from('%PDF-isolated-vm-referenced')
    mockRunSandboxTask.mockResolvedValue(compiled)

    const result = await resolveServableDocBytes({
      rawBuffer: source,
      fileName: 'report.pdf',
      workspaceId: WORKSPACE_ID,
    })

    expect(result).toEqual({ buffer: compiled, contentType: 'application/pdf' })
    expect(mockExecuteInSandbox).not.toHaveBeenCalled()
    expect(mockRunSandboxTask).toHaveBeenCalledWith(
      'pdf-generate',
      { code: source.toString('utf-8'), workspaceId: WORKSPACE_ID },
      expect.objectContaining({})
    )
    expect(mockReadWorkspaceFileMetadata).not.toHaveBeenCalled()
    expect(mockLoadCompiledDoc).not.toHaveBeenCalled()
    expect(mockStoreCompiledDoc).not.toHaveBeenCalled()
  })

  it('does not apply the remote 20-reference staging limit to isolated-vm documents', async () => {
    const source = referencedFileSource(21)
    setEnvFlags({ isDocSandboxEnabled: false })
    const compiled = Buffer.from('%PDF-isolated-vm-many-references')
    mockRunSandboxTask.mockResolvedValue(compiled)

    await expect(
      resolveServableDocBytes({
        rawBuffer: source,
        fileName: 'report.pdf',
        workspaceId: WORKSPACE_ID,
      })
    ).resolves.toEqual({ buffer: compiled, contentType: 'application/pdf' })
    expect(mockRunSandboxTask).toHaveBeenCalledTimes(1)
    expect(mockReadWorkspaceFileMetadata).not.toHaveBeenCalled()
    expect(mockStoreCompiledDoc).not.toHaveBeenCalled()
  })

  it('passes non-doc files through untouched with their extension content type', async () => {
    const text = Buffer.from('hello world', 'utf-8')
    const result = await resolveServableDocBytes({
      rawBuffer: text,
      fileName: 'notes.txt',
      workspaceId: WORKSPACE_ID,
    })

    expect(result.buffer).toBe(text)
    expect(result.contentType).toBe('text/plain')
    expect(mockLoadCompiledDoc).not.toHaveBeenCalled()
  })

  it('passes through a real binary XLSX (ZIP magic) without an artifact lookup', async () => {
    const result = await resolveServableDocBytes({
      rawBuffer: ZIP_MAGIC,
      fileName: 'sheet.xlsx',
      workspaceId: WORKSPACE_ID,
    })

    expect(result.buffer).toBe(ZIP_MAGIC)
    expect(mockLoadCompiledDoc).not.toHaveBeenCalled()
  })

  it('throws when a generated XLSX artifact is not ready (E2B enabled)', async () => {
    mockLoadCompiledDoc.mockResolvedValue(null)
    setEnvFlags({ isDocSandboxEnabled: true })

    await expect(
      resolveServableDocBytes({
        rawBuffer: XLSX_SOURCE,
        fileName: 'sheet.xlsx',
        workspaceId: WORKSPACE_ID,
      })
    ).rejects.toBeInstanceOf(DocCompileUserError)

    expect(mockRunSandboxTask).not.toHaveBeenCalled()
  })

  it('throws instead of returning XLSX source when E2B is disabled', async () => {
    mockLoadCompiledDoc.mockResolvedValue(null)
    setEnvFlags({ isDocSandboxEnabled: false })

    await expect(
      resolveServableDocBytes({
        rawBuffer: XLSX_SOURCE,
        fileName: 'sheet.xlsx',
        workspaceId: WORKSPACE_ID,
      })
    ).rejects.toBeInstanceOf(DocCompileUserError)

    expect(mockRunSandboxTask).not.toHaveBeenCalled()
  })

  it('throws instead of returning XLSX source when there is no workspaceId', async () => {
    await expect(
      resolveServableDocBytes({
        rawBuffer: XLSX_SOURCE,
        fileName: 'sheet.xlsx',
        workspaceId: undefined,
      })
    ).rejects.toBeInstanceOf(DocCompileUserError)

    expect(mockLoadCompiledDoc).not.toHaveBeenCalled()
    expect(mockRunSandboxTask).not.toHaveBeenCalled()
  })
})

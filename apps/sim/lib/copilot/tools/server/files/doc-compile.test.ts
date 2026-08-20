/**
 * @vitest-environment node
 */
import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  executeInSandboxMock,
  executeShellInSandboxMock,
  loadCompiledDocMock,
  publishCompiledDocArtifactMock,
  readWorkspaceFileContentMock,
  readWorkspaceFileMetadataMock,
  storeCompiledDocMock,
} = vi.hoisted(() => ({
  executeInSandboxMock: vi.fn(),
  executeShellInSandboxMock: vi.fn(),
  loadCompiledDocMock: vi.fn(),
  publishCompiledDocArtifactMock: vi.fn(),
  readWorkspaceFileContentMock: vi.fn(),
  readWorkspaceFileMetadataMock: vi.fn(),
  storeCompiledDocMock: vi.fn(),
}))

vi.mock('@/lib/execution/remote-sandbox', () => ({
  executeInSandbox: executeInSandboxMock,
  executeShellInSandbox: executeShellInSandboxMock,
}))
vi.mock('@/lib/execution/languages', () => ({
  CodeLanguage: { javascript: 'javascript', python: 'python' },
}))
vi.mock('@/lib/workspace-files/application/read-workspace-file-content', () => ({
  readWorkspaceFileContent: { execute: readWorkspaceFileContentMock },
}))
vi.mock('@/lib/workspace-files/application/read-workspace-file-metadata', () => ({
  readWorkspaceFileMetadata: { execute: readWorkspaceFileMetadataMock },
}))
vi.mock('./doc-compiled-store', () => ({
  loadCompiledDoc: loadCompiledDocMock,
  loadPublishedCompiledDoc: vi.fn(),
  publishCompiledDocArtifact: publishCompiledDocArtifactMock,
  storeCompiledDoc: storeCompiledDocMock,
}))

import { collectReferencedFileIds, compileDoc } from './doc-compile'

const ID = '550e8400-e29b-41d4-a716-446655440000'
const FILE_PRINCIPAL = { kind: 'session', userId: 'user-1' } as const

function referencedFileSource(count: number): string {
  return Array.from({ length: count }, (_, index) => `getFileBase64('file-${index}')`).join('\n')
}

afterAll(resetEnvFlagsMock)

describe('collectReferencedFileIds', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setEnvFlags({ isDocSandboxEnabled: true })
  })

  it('captures the id from getFileBase64(...) with single or double quotes', () => {
    expect(collectReferencedFileIds(`await getFileBase64('${ID}')`)).toEqual(new Set([ID]))
    expect(collectReferencedFileIds(`getFileBase64("abc_def-1")`)).toEqual(new Set(['abc_def-1']))
  })

  it('captures the id from pptx addImage(slide, id, opts) (second arg)', () => {
    const src = `await addImage(slide, '${ID}', { x: 1, y: 1, w: 2, h: 2 })`
    expect(collectReferencedFileIds(src)).toEqual(new Set([ID]))
  })

  it('captures the id from docx addImage(id, opts) (first arg)', () => {
    const src = `const img = await addImage('docx-img-1', { width: 200, height: 100 })`
    expect(collectReferencedFileIds(src)).toEqual(new Set(['docx-img-1']))
  })

  it('captures the id from pdf drawImage(page, id, opts) (second arg)', () => {
    const src = `await drawImage(page, 'pdf-img-2', { x: 0, y: 0, width: 100, height: 100 })`
    expect(collectReferencedFileIds(src)).toEqual(new Set(['pdf-img-2']))
  })

  it('still supports the legacy /home/user/inputs/<id> path form', () => {
    expect(collectReferencedFileIds(`fs.readFileSync('/home/user/inputs/legacy-1')`)).toEqual(
      new Set(['legacy-1'])
    )
  })

  it('collects and dedupes ids across multiple call sites', () => {
    const src = `
      await addImage(slide, 'logo-1', { x: 0, y: 0, w: 1, h: 1 });
      const uri = await getFileBase64('logo-1');
      await addImage(slide, 'crest-2', { x: 2, y: 0, w: 1, h: 1 });
    `
    expect(collectReferencedFileIds(src)).toEqual(new Set(['logo-1', 'crest-2']))
  })

  it('does not match id-like strings outside the image helpers', () => {
    const src = `slide.addText('order ${ID} shipped', { x: 1, y: 1, w: 8, h: 1 })`
    expect(collectReferencedFileIds(src)).toEqual(new Set())
  })

  it('does not match slide.addImage({ data }) — no fileId is present there', () => {
    const src = `slide.addImage({ data: base64Data, x: 1, y: 1, w: 2, h: 2 })`
    expect(collectReferencedFileIds(src)).toEqual(new Set())
  })

  it('returns an empty set when there are no image references', () => {
    expect(collectReferencedFileIds(`slide.addText('hello', { x: 1, y: 1 })`)).toEqual(new Set())
  })

  it('retains a full deck rebuild — every extracted image plus headroom fits the cap', () => {
    const ids = collectReferencedFileIds(referencedFileSource(500))

    expect(ids.size).toBe(500)
    expect(ids.has('file-0')).toBe(true)
    expect(ids.has('file-499')).toBe(true)
  })

  it('stops collecting at the one-over-cap sentinel', () => {
    const ids = collectReferencedFileIds(referencedFileSource(2000))

    expect(ids.size).toBe(501)
  })

  it('rejects an over-cap reference set before resolving any file metadata', async () => {
    await expect(
      compileDoc({
        source: referencedFileSource(501),
        fileName: 'report.pdf',
        workspaceId: 'workspace-1',
        filePrincipal: FILE_PRINCIPAL,
      })
    ).rejects.toThrow('More than 500 referenced input files; maximum is 500')
    expect(readWorkspaceFileMetadataMock).not.toHaveBeenCalled()
    expect(executeInSandboxMock).not.toHaveBeenCalled()
  })

  it('compiles referenced bytes and returns their canonical contributor identity', async () => {
    const contentUpdatedAt = new Date('2026-08-05T00:00:00.000Z')
    const record = {
      id: ID,
      workspaceId: 'workspace-1',
      name: 'reference.png',
      key: `workspace/workspace-1/${ID}-reference.png`,
      path: '/api/files/serve/reference.png',
      size: 10,
      type: 'image/png',
      uploadedBy: 'user-1',
      uploadedAt: contentUpdatedAt,
      updatedAt: contentUpdatedAt,
      contentUpdatedAt,
      storageContext: 'workspace' as const,
    }
    readWorkspaceFileMetadataMock.mockResolvedValue({ file: record, share: null })
    loadCompiledDocMock.mockResolvedValue(null)
    readWorkspaceFileContentMock.mockResolvedValue({ file: record, content: Buffer.from('image') })
    executeInSandboxMock.mockResolvedValue({
      error: null,
      exportedFileContent: Buffer.from('%PDF-built').toString('base64'),
    })

    await expect(
      compileDoc({
        source: `image = await getFileBase64('${ID}')`,
        fileName: 'report.pdf',
        workspaceId: 'workspace-1',
        filePrincipal: FILE_PRINCIPAL,
      })
    ).resolves.toEqual({
      buffer: Buffer.from('%PDF-built'),
      contentType: 'application/pdf',
      contributingFiles: [
        {
          fileId: ID,
          key: record.key,
          context: 'workspace',
          contentUpdatedAt,
        },
      ],
    })
    expect(readWorkspaceFileContentMock).toHaveBeenCalledWith({
      principal: FILE_PRINCIPAL,
      input: {
        fileId: ID,
        assertedWorkspaceId: 'workspace-1',
        maxBytes: 25 * 1024 * 1024,
      },
    })
    expect(executeInSandboxMock).toHaveBeenCalledOnce()
    expect(storeCompiledDocMock).toHaveBeenCalledOnce()
  })

  it('binds cached artifacts to the current referenced-file content version', async () => {
    const contentUpdatedAt = new Date('2026-08-05T01:00:00.000Z')
    const record = {
      id: ID,
      workspaceId: 'workspace-1',
      name: 'reference.png',
      key: `workspace/workspace-1/${ID}-reference.png`,
      path: '/api/files/serve/reference.png',
      size: 10,
      type: 'image/png',
      uploadedBy: 'user-1',
      uploadedAt: new Date('2026-08-05T00:00:00.000Z'),
      updatedAt: contentUpdatedAt,
      contentUpdatedAt,
      storageContext: 'workspace',
    }
    readWorkspaceFileMetadataMock.mockResolvedValue({ file: record, share: null })
    loadCompiledDocMock.mockResolvedValue(Buffer.from('%PDF-cached'))

    await expect(
      compileDoc({
        source: `image = await getFileBase64('${ID}')`,
        fileName: 'report.pdf',
        workspaceId: 'workspace-1',
        filePrincipal: FILE_PRINCIPAL,
      })
    ).resolves.toEqual({
      buffer: Buffer.from('%PDF-cached'),
      contentType: 'application/pdf',
      contributingFiles: [
        {
          fileId: ID,
          key: `workspace/workspace-1/${ID}-reference.png`,
          context: 'workspace',
          contentUpdatedAt,
        },
      ],
    })

    expect(loadCompiledDocMock).toHaveBeenCalledWith(
      'workspace-1',
      `image = await getFileBase64('${ID}')`,
      'pdf',
      JSON.stringify({
        version: 1,
        inputs: [
          {
            fileId: ID,
            key: `workspace/workspace-1/${ID}-reference.png`,
            context: 'workspace',
            contentVersion: contentUpdatedAt.toISOString(),
            size: 10,
          },
        ],
      })
    )
    expect(readWorkspaceFileContentMock).not.toHaveBeenCalled()
    expect(executeInSandboxMock).not.toHaveBeenCalled()
    expect(publishCompiledDocArtifactMock).toHaveBeenCalledWith(
      'workspace-1',
      `image = await getFileBase64('${ID}')`,
      'pdf',
      expect.stringContaining(ID)
    )
  })
})

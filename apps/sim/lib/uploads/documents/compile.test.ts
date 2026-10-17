import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import {
  readWorkspaceFileMetadataMock,
  readWorkspaceFileMetadataMockFns,
} from '@sim/testing/mocks/read-workspace-file-metadata.mock'
import { remoteSandboxMock, remoteSandboxMockFns } from '@sim/testing/mocks/remote-sandbox.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  loadCompiledDocMock,
  publishCompiledDocArtifactMock,
  readWorkspaceFileContentMock,
  storeCompiledDocMock,
  runSandboxTaskMock,
} = vi.hoisted(() => ({
  runSandboxTaskMock: vi.fn(),
  loadCompiledDocMock: vi.fn(),
  publishCompiledDocArtifactMock: vi.fn(),
  readWorkspaceFileContentMock: vi.fn(),
  storeCompiledDocMock: vi.fn(),
}))

vi.mock('@/lib/execution/remote-sandbox', () => remoteSandboxMock)
vi.mock('@/lib/execution/languages', () => ({
  CodeLanguage: { javascript: 'javascript', python: 'python' },
}))
vi.mock('@/lib/workspace-files/application/read-workspace-file-content', () => ({
  readWorkspaceFileContent: { execute: readWorkspaceFileContentMock },
}))
vi.mock(
  '@/lib/workspace-files/application/read-workspace-file-metadata',
  () => readWorkspaceFileMetadataMock
)
vi.mock('@/lib/execution/sandbox/run-task', () => ({ runSandboxTask: runSandboxTaskMock }))
vi.mock('@/lib/uploads/documents/compiled-store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/uploads/documents/compiled-store')>()),
  loadCompiledDoc: loadCompiledDocMock,
  loadPublishedCompiledDoc: vi.fn(),
  publishCompiledDocArtifact: publishCompiledDocArtifactMock,
  storeCompiledDoc: storeCompiledDocMock,
}))

import { type ContentDeliveryGate, observeContentDelivery } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { createCopilotChatFilePrincipal } from '@/lib/mothership/auth/file-delegation'
import {
  collectReferencedFileIds,
  compileDoc,
  compileFileDocument,
} from '@/lib/uploads/documents/compile'
import { DocCompileUserError } from '@/lib/uploads/documents/compile-error'

const executeInSandboxMock = remoteSandboxMockFns.mockExecuteInSandbox
const readMetadataMock = readWorkspaceFileMetadataMockFns.mockReadWorkspaceFileMetadata

const ID = '550e8400-e29b-41d4-a716-446655440000'
const FILE_PRINCIPAL = createSessionPrincipal()

function referencedFileSource(count: number): string {
  return Array.from({ length: count }, (_, index) => `getFileBase64('file-${index}')`).join('\n')
}

afterAll(resetEnvFlagsMock)

describe('collectReferencedFileIds', () => {
  beforeEach(() => {
    setEnvFlags({ isDocSandboxEnabled: true })
  })

  it('captures the id from getFileBase64(...) with single or double quotes', () => {
    expect(collectReferencedFileIds(`await getFileBase64('${ID}')`, 'javascript')).toEqual(
      new Set([ID])
    )
    expect(collectReferencedFileIds(`getFileBase64("abc_def-1")`, 'javascript')).toEqual(
      new Set(['abc_def-1'])
    )
  })

  it('captures the id from pptx addImage(slide, id, opts) (second arg)', () => {
    const src = `await addImage(slide, '${ID}', { x: 1, y: 1, w: 2, h: 2 })`
    expect(collectReferencedFileIds(src, 'javascript')).toEqual(new Set([ID]))
  })

  it('captures the id from docx addImage(id, opts) (first arg)', () => {
    const src = `const img = await addImage('docx-img-1', { width: 200, height: 100 })`
    expect(collectReferencedFileIds(src, 'javascript')).toEqual(new Set(['docx-img-1']))
  })

  it('captures the id from pdf drawImage(page, id, opts) (second arg)', () => {
    const src = `await drawImage(page, 'pdf-img-2', { x: 0, y: 0, width: 100, height: 100 })`
    expect(collectReferencedFileIds(src, 'javascript')).toEqual(new Set(['pdf-img-2']))
  })

  it('still supports the legacy /home/user/inputs/<id> path form', () => {
    expect(
      collectReferencedFileIds(`fs.readFileSync('/home/user/inputs/legacy-1')`, 'javascript')
    ).toEqual(new Set(['legacy-1']))
  })

  it('ignores helper examples and comments while resolving executable calls', () => {
    const source = [
      '// getFileBase64("comment")',
      '/* addImage(slide, "comment-block") */',
      'const example = \'getFileBase64("string-example")\'',
      'const template = `addImage("template-example")`',
      'await getFileBase64("actual")',
    ].join('\n')
    expect(collectReferencedFileIds(source, 'javascript')).toEqual(new Set(['actual']))
  })

  it('ignores JavaScript regex literals and preserves calls after regex quotes', () => {
    const source = [
      'const example = /getFileBase64("regex-example")/',
      "const quote = /'/; getFileBase64('actual')",
      `const interpolation = \`\${/}/.test("}") ? getFileBase64("nested") : ""}\``,
      'const path = `/home/user/inputs/template-path`',
    ].join('\n')
    expect(collectReferencedFileIds(source, 'javascript')).toEqual(
      new Set(['actual', 'nested', 'template-path'])
    )
  })

  it('distinguishes Python floor division and quoted examples from file reads', () => {
    const source = [
      '# input_path("comment")',
      "'''input_path(\"example\")'''",
      'ratio = 4 // 2; image = input_path("actual")',
    ].join('\n')
    expect(collectReferencedFileIds(source, 'python')).toEqual(new Set(['actual']))
  })

  it('discovers Python f-string expressions without staging literal examples', () => {
    const source = [
      `example = f"input_path('example') {{input_path('escaped-example')}}"`,
      `path = f"{input_path('actual')}"`,
      `raw = input_path(r'raw-id')`,
      `nested = f"{f\"{input_path('nested')}\"}"`,
      `formatted = f"{value:input_path('format-example'){input_path('width')}}"`,
      `mapping = f"{ {'x': input_path('mapping')} }"`,
      `static = input_path(f'static-id')`,
    ].join('\n')
    expect(collectReferencedFileIds(source, 'python')).toEqual(
      new Set(['actual', 'raw-id', 'nested', 'width', 'mapping', 'static-id'])
    )
  })

  it('reports malformed JavaScript as a document source error before compilation', async () => {
    await expect(
      compileDoc({
        source: `const image = getFileBase64('unterminated`,
        fileName: 'report.pptx',
        workspaceId: 'workspace-1',
        filePrincipal: FILE_PRINCIPAL,
      })
    ).rejects.toBeInstanceOf(DocCompileUserError)
  })

  it('collects and dedupes ids across multiple call sites', () => {
    const src = `
      await addImage(slide, 'logo-1', { x: 0, y: 0, w: 1, h: 1 });
      const uri = await getFileBase64('logo-1');
      await addImage(slide, 'crest-2', { x: 2, y: 0, w: 1, h: 1 });
    `
    expect(collectReferencedFileIds(src, 'javascript')).toEqual(new Set(['logo-1', 'crest-2']))
  })

  it('does not match id-like strings outside the image helpers', () => {
    const src = `slide.addText('order ${ID} shipped', { x: 1, y: 1, w: 8, h: 1 })`
    expect(collectReferencedFileIds(src, 'javascript')).toEqual(new Set())
  })

  it('does not match slide.addImage({ data }) — no fileId is present there', () => {
    const src = `slide.addImage({ data: base64Data, x: 1, y: 1, w: 2, h: 2 })`
    expect(collectReferencedFileIds(src, 'javascript')).toEqual(new Set())
  })

  it('retains a full deck rebuild — every extracted image plus headroom fits the cap', () => {
    const ids = collectReferencedFileIds(referencedFileSource(500), 'javascript')

    expect(ids.size).toBe(500)
    expect(ids.has('file-0')).toBe(true)
    expect(ids.has('file-499')).toBe(true)
  })

  it('stops collecting at the one-over-cap sentinel', () => {
    const ids = collectReferencedFileIds(referencedFileSource(2000), 'javascript')

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
    expect(readMetadataMock).not.toHaveBeenCalled()
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
    readMetadataMock.mockResolvedValue({ file: record, share: null })
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
    ).resolves.toMatchObject({
      buffer: Buffer.from('%PDF-built'),
      contentType: 'application/pdf',
      dependsOnReferencedFiles: true,
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
    readMetadataMock.mockResolvedValue({ file: record, share: null })
    loadCompiledDocMock.mockResolvedValue(Buffer.from('%PDF-cached'))

    await expect(
      compileDoc({
        source: `image = await getFileBase64('${ID}')`,
        fileName: 'report.pdf',
        workspaceId: 'workspace-1',
        filePrincipal: FILE_PRINCIPAL,
      })
    ).resolves.toMatchObject({
      buffer: Buffer.from('%PDF-cached'),
      contentType: 'application/pdf',
      dependsOnReferencedFiles: true,
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

function referencedFileVersion(at: string) {
  const contentUpdatedAt = new Date(at)
  return {
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
}

/** A sandbox build that reads the referenced file through its broker, as the isolated VM does. */
function buildReadingReferencedFile() {
  runSandboxTaskMock.mockImplementation(
    async (
      _task: string,
      _input: unknown,
      options: { onWorkspaceFileAccess?: (identity: unknown) => void }
    ) => {
      const { file } = await readMetadataMock()
      options.onWorkspaceFileAccess?.({
        fileId: ID,
        key: file.key,
        context: 'workspace',
        contentUpdatedAt: file.contentUpdatedAt,
      })
      return Buffer.from('%PDF-built')
    }
  )
}

describe('isolated-VM compile for Chat', () => {
  beforeEach(() => {
    setEnvFlags({ isDocSandboxEnabled: false })
  })

  it('rebuilds a cached build that read an older version of a file it names', async () => {
    const chat = createCopilotChatFilePrincipal({
      userId: 'user-1',
      workspaceId: 'workspace-1',
      chatId: 'chat-1',
    })
    const admitAll: ContentDeliveryGate = {
      async admit(sources) {
        return sources.map(() => true)
      },
    }
    buildReadingReferencedFile()
    const compile = () =>
      observeContentDelivery(admitAll, () =>
        compileDoc({
          source: `image = await getFileBase64('${ID}') // cache-version`,
          fileName: 'report.pdf',
          workspaceId: 'workspace-1',
          filePrincipal: chat,
        })
      )
    readMetadataMock.mockResolvedValue({
      file: referencedFileVersion('2026-08-05T00:00:00.000Z'),
      share: null,
    })
    await compile()
    await compile()
    expect(runSandboxTaskMock).toHaveBeenCalledOnce()

    readMetadataMock.mockResolvedValue({
      file: referencedFileVersion('2026-08-06T00:00:00.000Z'),
      share: null,
    })
    await compile()
    expect(runSandboxTaskMock).toHaveBeenCalledTimes(2)
  })
})

describe('isolated-VM compile for a session', () => {
  beforeEach(() => {
    setEnvFlags({ isDocSandboxEnabled: false })
  })

  const compile = (marker: string) =>
    compileDoc({
      source: `image = await getFileBase64('${ID}') // ${marker}`,
      fileName: 'report.pdf',
      workspaceId: 'workspace-1',
      filePrincipal: FILE_PRINCIPAL,
    })

  it('rebuilds a cached build whose referenced file was edited, reporting the current version', async () => {
    buildReadingReferencedFile()
    readMetadataMock.mockResolvedValue({
      file: referencedFileVersion('2026-08-05T00:00:00.000Z'),
      share: null,
    })
    await compile('session-edited')
    await compile('session-edited')
    expect(runSandboxTaskMock).toHaveBeenCalledOnce()

    const edited = referencedFileVersion('2026-08-06T00:00:00.000Z')
    readMetadataMock.mockResolvedValue({ file: edited, share: null })
    const rebuilt = await compile('session-edited')
    expect(runSandboxTaskMock).toHaveBeenCalledTimes(2)
    expect(rebuilt.contributingFiles).toEqual([
      expect.objectContaining({ fileId: ID, contentUpdatedAt: edited.contentUpdatedAt }),
    ])
  })

  it('rebuilds a cached build whose referenced file was deleted', async () => {
    buildReadingReferencedFile()
    readMetadataMock.mockResolvedValue({
      file: referencedFileVersion('2026-08-05T00:00:00.000Z'),
      share: null,
    })
    await compile('session-deleted')
    readMetadataMock.mockRejectedValueOnce(new OrchestrationError('not_found', 'File not found'))
    await compile('session-deleted')
    expect(runSandboxTaskMock).toHaveBeenCalledTimes(2)
  })
})

describe('compileFileDocument source engine', () => {
  it('uses the JavaScript PDF task even with the document sandbox enabled', async () => {
    setEnvFlags({ isDocSandboxEnabled: true })
    loadCompiledDocMock.mockResolvedValue(null)
    runSandboxTaskMock.mockResolvedValue(Buffer.from('%PDF-1.7'))
    runSandboxTaskMock.mockClear()
    executeInSandboxMock.mockClear()
    const source = 'const doc = await PDFDocument.create()'
    const result = await compileFileDocument({
      owner: { entityType: 'project', entityId: ID },
      source,
      sourceMime: 'text/x-pdflibjs',
      fileName: 'report.pdf',
      inputs: [],
      maxBytes: 1024,
    })
    expect(result.buffer.toString()).toBe('%PDF-1.7')
    expect(runSandboxTaskMock).toHaveBeenCalledWith(
      'pdf-generate',
      { code: source },
      expect.any(Object)
    )
    expect(executeInSandboxMock).not.toHaveBeenCalled()
  })
})

it('separates cached PDF artifacts by effective source dialect', async () => {
  setEnvFlags({ isDocSandboxEnabled: true })
  const identities: string[] = []
  loadCompiledDocMock.mockImplementation(async (_owner, _source, _ext, identity) => {
    identities.push(identity)
    return Buffer.from(identity.includes('javascript') ? '%PDF-JS' : '%PDF-Python')
  })
  const input = {
    owner: { entityType: 'project' as const, entityId: ID },
    source: 'shared source',
    fileName: 'report.pdf',
    inputs: [],
    maxBytes: 1024,
  }
  const js = await compileFileDocument({ ...input, sourceMime: 'text/x-pdflibjs' })
  const python = await compileFileDocument({ ...input, sourceMime: 'text/x-python' })
  expect(js.buffer.toString()).toBe('%PDF-JS')
  expect(python.buffer.toString()).toBe('%PDF-Python')
  expect(js.artifactKey).not.toBe(python.artifactKey)
  expect(identities[0]).not.toBe(identities[1])
})

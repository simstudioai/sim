/** @vitest-environment node */
import type { Principal } from '@sim/auth/principal'
import { PDFDocument } from 'pdf-lib'
import sharp from 'sharp'
import { SimApiError } from 'sim/embed'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  artifact: vi.fn(),
  request: vi.fn(),
  scratch: vi.fn(),
}))
vi.mock('@/lib/workspace-files/application/resolve-workspace-file-reference', () => ({
  resolveWorkspaceFileReference: mocks.resolve,
}))
vi.mock('@/lib/workspace-files/application/read-workspace-file-artifact', () => ({
  readWorkspaceFileArtifact: { execute: mocks.artifact },
}))

vi.mock('@/lib/mothership/chat/application/read-sandbox-file', () => ({
  readChatSandboxFile: { execute: mocks.scratch },
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { runEngine } from '@/lib/mothership/agent-cli/engines'
import type { AgentCliRuntime } from '@/lib/mothership/agent-cli/types'
import { ArtifactObservations } from '@/lib/mothership/generated/observations'
import { fileOperations } from '@/lib/workspace-files/application/operations'

const workspaceId = '11111111-1111-4111-8111-111111111111'
const fileId = '22222222-2222-4222-8222-222222222222'
const principal: Principal = { kind: 'session', userId: 'reader', sessionId: 'session' }
const runtime: AgentCliRuntime = {
  principal,
  workspaceId,
  userId: 'reader',
  chatId: 'trusted-chat',
  client: { request: mocks.request },
}
const file = {
  id: fileId,
  workspaceId,
  name: 'image.png',
  type: 'image/png',
  size: 100,
  folderPath: null,
  vfsNamespace: 'uploads',
}

function textResponse(name = 'notes.txt') {
  return {
    data: {
      fileId,
      name,
      path: `uploads/${name}`,
      type: 'text/plain',
      text: 'read content',
      truncated: false,
      degraded: false,
      degradedReason: null,
      charCount: 12,
      byteCount: 12,
    },
  }
}

describe('content-aware files read augmentation', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    mocks.resolve.mockResolvedValue(file)
    mocks.artifact.mockResolvedValue({
      file,
      contentType: 'image/png',
      buffer: await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } })
        .png()
        .toBuffer(),
    })
    mocks.request.mockResolvedValue(textResponse())
  })

  it.each(['image/png', 'application/octet-stream', 'image/png; charset=binary'])(
    'reads uploaded PNG with %s on its first call, without a text request',
    async (type) => {
      mocks.resolve.mockResolvedValue({ ...file, type })
      const result = await runEngine('files read', ['uploads/image.png'], runtime, {})
      expect(result.exitCode).toBe(0)
      expect(JSON.parse(result.stdout)).toMatchObject({
        fileId,
        representation: 'visual',
        mediaType: 'image/png',
        truncated: false,
      })
      expect(ArtifactObservations.parse(result.observations)[0]?.data).toBeTruthy()
      expect(result.resources?.[0]).toMatchObject({
        readOnly: true,
        resource: { id: fileId, type: 'file' },
      })
      expect(mocks.request).not.toHaveBeenCalled()
      expect(mocks.resolve).toHaveBeenCalledWith({
        principal,
        operation: fileOperations.readContent,
        workspaceId,
        reference: 'uploads/image.png',
        chatId: 'trusted-chat',
      })
      expect(mocks.artifact).toHaveBeenCalledWith({
        principal,
        input: {
          workspaceId,
          reference: fileId,
          chatId: 'trusted-chat',
          maxBytes: 25 * 1024 * 1024,
        },
      })
    }
  )

  it.each([
    ['notes.txt', 'text/plain'],
    ['data.csv', 'text/csv'],
    ['rows.xlsx', 'application/octet-stream'],
    ['document.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['slides.pptx', 'application/octet-stream'],
    ['document.odt', 'application/octet-stream'],
    ['main.ts', 'text/typescript'],
    ['script', 'application/javascript'],
    ['report.docx', 'text/x-docxjs'],
  ])('reads %s through the existing text/provenance transport', async (name, type) => {
    mocks.resolve.mockResolvedValue({ ...file, name, type })
    mocks.request.mockResolvedValue(textResponse(name))
    const result = await runEngine('files read', [`uploads/${name}`], runtime, {
      offset: '3',
      limit: '2',
      'max-bytes': '4096',
    })
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      representation: 'text',
      text: 'read content',
      degraded: false,
    })
    expect(mocks.request).toHaveBeenCalledWith(`/api/v2/files/${fileId}/text`, {
      query: { workspaceId, offset: '3', limit: '2', maxBytes: '4096' },
    })
    expect(mocks.artifact).not.toHaveBeenCalled()
  })

  it.each(['application/pdf', 'text/x-pdflibjs'])(
    'reads %s PDF visually by default and text for a line request',
    async (type) => {
      const pdf = await PDFDocument.create()
      for (let i = 0; i < 23; i++) pdf.addPage()
      const pdfFile = { ...file, name: 'report.pdf', type }
      mocks.resolve.mockResolvedValue(pdfFile)
      mocks.artifact.mockResolvedValue({
        file: pdfFile,
        buffer: Buffer.from(await pdf.save()),
        contentType: 'application/pdf',
      })
      const visual = await runEngine('files read', ['report.pdf'], runtime, {})
      expect(visual.exitCode).toBe(0)
      expect(JSON.parse(visual.stdout)).toMatchObject({
        representation: 'visual',
        truncated: true,
        pages: { first: 1, last: 20, total: 23 },
      })
      expect(visual.observations?.[0]?.pageCount).toBe(20)
      const text = await runEngine('files read', ['report.pdf'], runtime, { limit: '50' })
      expect(text.exitCode).toBe(0)
      expect(JSON.parse(text.stdout).representation).toBe('text')
    }
  )

  it.each([
    ['clip.mp4', 'video/mp4'],
    ['audio.mp3', 'audio/mpeg'],
    ['archive.zip', 'application/zip'],
    ['bytes.bin', 'application/octet-stream'],
  ])(
    'returns honest metadata for %s without pretending to read binary bytes',
    async (name, type) => {
      mocks.resolve.mockResolvedValue({ ...file, name, type })
      const result = await runEngine('files read', [name], runtime, {})
      expect(result.exitCode).toBe(0)
      expect(JSON.parse(result.stdout)).toMatchObject({
        fileId,
        representation: 'binary',
        contentAvailable: false,
        note: expect.stringContaining('Content was not inspected'),
      })
      expect(result.observations).toBeUndefined()
      expect(mocks.artifact).not.toHaveBeenCalled()
      expect(mocks.request).not.toHaveBeenCalled()
    }
  )

  it('rejects incompatible flags and invalid byte/line bounds before lookup', async () => {
    for (const flags of [
      { render: true, limit: '2' } as const,
      { pages: '1', offset: '1' },
      { offset: '0' },
      { offset: true } as const,
      { limit: true } as const,
      { 'max-bytes': true } as const,
      { 'max-bytes': '999999999' },
    ]) {
      expect((await runEngine('files read', ['report.pdf'], runtime, flags)).exitCode).toBe(1)
    }
    expect(mocks.resolve).not.toHaveBeenCalled()
  })

  it('does not bypass denied canonical access or opaque provenance and hides unexpected failures', async () => {
    mocks.resolve.mockRejectedValueOnce(new OrchestrationError('forbidden', 'Access denied'))
    expect((await runEngine('files read', ['image.png'], runtime, {})).stderr).toContain(
      'Access denied'
    )
    expect(mocks.artifact).not.toHaveBeenCalled()
    mocks.artifact.mockRejectedValueOnce(
      new OrchestrationError('forbidden', 'Opaque file provenance is unsafe')
    )
    const denied = await runEngine('files read', ['image.png'], runtime, {})
    expect(denied.stderr).toContain('provenance')
    expect(denied.observations).toBeUndefined()
    mocks.resolve.mockRejectedValueOnce(new Error('private database connection string'))
    expect((await runEngine('files read', ['image.png'], runtime, {})).stderr).not.toContain(
      'connection string'
    )
  })

  it('preserves actionable text extraction errors from the authenticated CLI client', async () => {
    mocks.resolve.mockResolvedValue({
      ...file,
      name: 'report.docx',
      type: 'application/octet-stream',
    })
    mocks.request.mockRejectedValue(
      new SimApiError('Compiled artifact is pending. Retry after compilation.', 409)
    )
    expect((await runEngine('files read', ['report.docx'], runtime, {})).stderr).toContain(
      'Compiled artifact is pending'
    )
  })

  it('does not silently ignore missing page values or a value on --render', async () => {
    for (const flags of [{ pages: true } as const, { pages: '' }, { render: 'false' }]) {
      expect((await runEngine('files read', ['image.png'], runtime, flags)).exitCode).toBe(1)
    }
    expect(mocks.artifact).not.toHaveBeenCalled()
  })

  it('requires a principal and observes cancellation before lookup', async () => {
    const { principal: _principal, ...anonymous } = runtime
    expect((await runEngine('files read', ['image.png'], anonymous, {})).exitCode).toBe(1)
    const signal = AbortSignal.abort()
    expect(
      (await runEngine('files read', ['image.png'], { ...runtime, signal }, {})).exitCode
    ).toBe(1)
    expect(mocks.resolve).not.toHaveBeenCalled()
  })
})

describe('scratch files read and explicit inline publication', () => {
  beforeEach(() => vi.clearAllMocks())
  it('reads an authorized scratch PNG with no workspace lookup, persistence or resource', async () => {
    const buffer = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'blue' } })
      .png()
      .toBuffer()
    mocks.scratch.mockResolvedValue({ buffer, name: 'scratch.png', path: '/tmp/scratch.png' })
    const result = await runEngine('files read', ['/tmp/scratch.png'], runtime, {})
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      source: 'sandbox',
      representation: 'visual',
      path: '/tmp/scratch.png',
    })
    expect(ArtifactObservations.parse(result.observations)).toHaveLength(1)
    expect(result.resources).toBeUndefined()
    expect(mocks.resolve).not.toHaveBeenCalled()
  })
  it('preserves an absolute virtual workspace reference without selecting a sandbox', async () => {
    mocks.resolve.mockRejectedValue(new OrchestrationError('not_found', 'File missing'))
    await runEngine('files read', ['/uploads/image.png'], runtime, {})
    expect(mocks.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ reference: '/uploads/image.png' })
    )
    expect(mocks.scratch).not.toHaveBeenCalled()
  })
  it('does not fall back to scratch after a missing workspace reference', async () => {
    mocks.resolve.mockRejectedValue(new OrchestrationError('not_found', 'File missing'))
    expect((await runEngine('files read', ['files/missing.png'], runtime, {})).exitCode).toBe(1)
    expect(mocks.scratch).not.toHaveBeenCalled()
  })
})

/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  principal: vi.fn(),
  subject: vi.fn(),
  authorize: vi.fn(),
  record: vi.fn(),
  modelSafe: vi.fn(),
  download: vi.fn(),
  metadata: vi.fn(),
}))
vi.mock('@sim/auth/principal', () => ({ resolvePrincipalSubject: mocks.subject }))
vi.mock('@/lib/internal/principals/executor', () => ({
  createExecutorPrincipalFromExecutionContext: mocks.principal,
}))
vi.mock('@/lib/execution/payloads/materialization.server', () => ({
  assertUserFileContentAccess: mocks.authorize,
}))
vi.mock('@/lib/workspace-files/application/read-workspace-file-content-by-key', () => ({
  readWorkspaceFileRecordByKey: { execute: mocks.record },
}))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-secret-provenance', () => ({
  isModelSafeWorkspaceFileKey: mocks.modelSafe,
}))
vi.mock('@/lib/uploads/core/storage-service', () => ({ downloadFile: mocks.download }))
vi.mock('sharp', () => ({ default: () => ({ metadata: mocks.metadata }) }))

import { readOciVisionImage } from '@/lib/internal/oci-vision/image-input'
import { ociVisionInputSchema } from '@/lib/internal/oci-vision/schema'
import type { InternalToolOperationContext } from '@/lib/internal/tool-operations/types'

const file = {
  name: 'image.png',
  key: 'workspace/workspace-1/image.png',
  size: 100,
  type: 'image/png',
}
const context = {
  workspaceId: 'workspace-1',
  workflowId: 'workflow-1',
  executionId: 'execution-1',
  executorDelegationOrigin: { kind: 'workflow' },
  fileKeys: [file.key],
} as unknown as InternalToolOperationContext
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])

describe('OCI Vision authorized image input', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.principal.mockResolvedValue({ kind: 'test-principal' })
    mocks.subject.mockReturnValue({ kind: 'sim_user', userId: 'user-1' })
    mocks.authorize.mockResolvedValue(undefined)
    mocks.record.mockResolvedValue({ file: { size: 100 } })
    mocks.modelSafe.mockResolvedValue(true)
    mocks.download.mockResolvedValue(png)
    mocks.metadata.mockResolvedValue({ width: 32, height: 32 })
  })

  it('authorizes stored content with trusted execution scope before reading', async () => {
    const signal = new AbortController().signal
    await expect(readOciVisionImage(file, context, signal)).resolves.toEqual(png)
    expect(mocks.authorize).toHaveBeenCalledWith(
      { key: file.key, context: 'workspace' },
      expect.objectContaining({
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
        fileKeys: [file.key],
        userId: 'user-1',
      })
    )
    expect(mocks.authorize.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.download.mock.invocationCallOrder[0]
    )
    expect(mocks.modelSafe.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.download.mock.invocationCallOrder[0]
    )
    expect(mocks.download).toHaveBeenCalledWith({
      key: file.key,
      context: 'workspace',
      maxBytes: 5_000_000,
      signal,
    })
  })

  it('rejects an unauthorized stored key before reading bytes', async () => {
    mocks.authorize.mockRejectedValueOnce(new Error('Denied'))
    await expect(
      readOciVisionImage({ ...file, key: 'workspace/other-workspace/image.png' }, context)
    ).rejects.toThrow('Denied')
    expect(mocks.download).not.toHaveBeenCalled()
  })

  it('rejects persisted resolved-secret image content before model egress', async () => {
    mocks.modelSafe.mockResolvedValueOnce(false)
    await expect(readOciVisionImage(file, context)).rejects.toThrow('not safe for model input')
    expect(mocks.download).not.toHaveBeenCalled()
  })

  it.each([
    { ...file, base64: 'inline-override' },
    { ...file, context: 'execution' },
  ])('rejects forged file metadata %#', async (input) => {
    await expect(readOciVisionImage(input, context)).rejects.toThrow()
    expect(mocks.download).not.toHaveBeenCalled()
  })

  it('rejects arbitrary external URLs and malformed metadata at the boundary', () => {
    for (const input of [
      { name: 'image.png', size: 10, url: 'https://external.example/image.png' },
      { ...file, size: -1 },
      { ...file, name: '' },
    ]) {
      expect(
        ociVisionInputSchema.safeParse({
          credentialId: 'c',
          operation: 'analyze_image',
          source: 'file',
          file: input,
          features: ['TEXT_DETECTION'],
        }).success
      ).toBe(false)
    }
  })

  it('requires trusted file execution context', async () => {
    await expect(readOciVisionImage(file, { workflowId: 'workflow-1' })).rejects.toThrow(
      'Trusted execution context'
    )
    expect(mocks.download).not.toHaveBeenCalled()
  })

  it('enforces declared, canonical, and actual byte limits', async () => {
    await expect(readOciVisionImage({ ...file, size: 5_000_001 }, context)).rejects.toThrow()
    expect(mocks.download).not.toHaveBeenCalled()
    mocks.record.mockResolvedValueOnce({ file: { size: 5_000_001 } })
    await expect(readOciVisionImage({ ...file, size: 1 }, context)).rejects.toThrow()
    expect(mocks.download).not.toHaveBeenCalled()
    mocks.download.mockResolvedValueOnce(Buffer.alloc(5_000_001))
    await expect(readOciVisionImage(file, context)).rejects.toThrow()
    expect(mocks.metadata).not.toHaveBeenCalled()
  })

  it.each([
    { width: 31, height: 32 },
    { width: 32, height: 10001 },
    { width: 32, height: 32, pages: 2 },
    {},
  ])('rejects unsupported dimensions or multiple pages %#', async (metadata) => {
    mocks.metadata.mockResolvedValueOnce(metadata)
    await expect(readOciVisionImage(file, context)).rejects.toThrow('single JPEG or PNG')
  })

  it('accepts a JPEG signature regardless of untrusted MIME metadata', async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])
    mocks.download.mockResolvedValueOnce(jpeg)
    await expect(readOciVisionImage({ ...file, type: 'text/plain' }, context)).resolves.toEqual(
      jpeg
    )
  })

  it('rejects forged MIME types when bytes are not JPEG or PNG', async () => {
    mocks.download.mockResolvedValueOnce(Buffer.from('not an image'))
    await expect(readOciVisionImage(file, context)).rejects.toThrow('JPEG or PNG image bytes')
    expect(mocks.metadata).not.toHaveBeenCalled()
  })

  it('propagates aborts before and after storage download', async () => {
    await expect(
      readOciVisionImage(file, context, AbortSignal.abort(new Error('Stopped')))
    ).rejects.toThrow('Stopped')
    expect(mocks.download).not.toHaveBeenCalled()
    const controller = new AbortController()
    mocks.download.mockImplementationOnce(async () => {
      controller.abort(new Error('Stopped during download'))
      return png
    })
    await expect(readOciVisionImage(file, context, controller.signal)).rejects.toThrow(
      'Stopped during download'
    )
    expect(mocks.metadata).not.toHaveBeenCalled()
  })
})

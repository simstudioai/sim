/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PRIVATE_MODEL_INPUT_PROVENANCE_HEADER } from '@/lib/execution/model-input-provenance'
import {
  RESOLVED_SECRET_PROVENANCE_FIELD,
  RESOLVED_SECRET_PROVENANCE_METADATA_V1,
} from '@/lib/execution/private-tool-metadata'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'

const mocks = vi.hoisted(() => ({
  analyzeVision: vi.fn(),
  assertToolFileAccess: vi.fn(),
  downloadFileFromStorage: vi.fn(),
  isModelSafeWorkspaceFileKey: vi.fn(),
  resolveInternalFileUrl: vi.fn(),
  validateUrlWithDNS: vi.fn(),
}))

vi.mock('@/lib/internal/vision/client', () => ({ analyzeVision: mocks.analyzeVision }))
vi.mock('@/app/api/files/authorization', () => ({
  assertToolFileAccess: mocks.assertToolFileAccess,
}))
vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadFileFromStorage: mocks.downloadFileFromStorage,
  resolveInternalFileUrl: mocks.resolveInternalFileUrl,
}))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-secret-provenance', () => ({
  isModelSafeWorkspaceFileKey: mocks.isModelSafeWorkspaceFileKey,
  MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE:
    'File cannot be sent to a model because its secret provenance is unavailable',
}))
vi.mock('@/lib/core/security/input-validation.server', () => ({
  validateUrlWithDNS: mocks.validateUrlWithDNS,
}))

import { executeVisionOperation } from '@/lib/internal/vision/operations'

const imageFile = {
  id: 'file-1',
  key: 'workspace/workspace-1/image.png',
  name: 'image.png',
  size: 3,
  type: 'image/png',
  url: '/api/files/serve/s3/workspace/workspace-1/image.png',
}

const context = {
  headers: new Headers(),
  requestId: 'request-1',
  userId: 'user-1',
}

describe('Vision operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.analyzeVision.mockResolvedValue({ content: 'A lighthouse', model: 'gpt-5.2' })
    mocks.assertToolFileAccess.mockResolvedValue(null)
    mocks.downloadFileFromStorage.mockResolvedValue(Buffer.from([1, 2, 3]))
    mocks.isModelSafeWorkspaceFileKey.mockResolvedValue(true)
    mocks.resolveInternalFileUrl.mockResolvedValue({
      fileUrl: 'https://storage.example.com/image.png',
    })
    mocks.validateUrlWithDNS.mockResolvedValue({
      isValid: true,
      resolvedIP: '203.0.113.10',
    })
  })

  it('authorizes and bounds stored files before provider egress', async () => {
    await executeVisionOperation(
      { apiKey: 'secret', imageFile, model: 'gpt-5.2', prompt: null },
      context
    )

    expect(mocks.assertToolFileAccess).toHaveBeenCalledWith(
      imageFile.key,
      'user-1',
      'request-1',
      expect.anything()
    )
    expect(mocks.downloadFileFromStorage).toHaveBeenCalledWith(
      expect.objectContaining({ key: imageFile.key }),
      'request-1',
      expect.anything(),
      { maxBytes: MAX_BUFFERED_TRANSFER_BYTES }
    )
    expect(mocks.analyzeVision).toHaveBeenCalledWith(
      {
        apiKey: 'secret',
        imageSource: 'data:image/png;base64,AQID',
        imageContentType: 'image/png',
        model: 'gpt-5.2',
        prompt: 'Please analyze this image and describe what you see in detail.',
        remoteImageResolvedIP: undefined,
      },
      undefined
    )
  })

  it('forwards cancellation through the provider operation', async () => {
    const controller = new AbortController()

    await executeVisionOperation(
      { apiKey: 'secret', imageFile, model: 'gpt-5.2', prompt: null },
      { ...context, signal: controller.signal }
    )

    expect(mocks.analyzeVision).toHaveBeenCalledWith(expect.anything(), controller.signal)
  })

  it('rejects incomplete private provenance before resolving the image', async () => {
    const headers = new Headers({
      [PRIVATE_MODEL_INPUT_PROVENANCE_HEADER]: RESOLVED_SECRET_PROVENANCE_METADATA_V1,
    })

    await expect(
      executeVisionOperation(
        {
          apiKey: 'secret',
          imageFile,
          model: 'gpt-5.2',
          prompt: null,
          [RESOLVED_SECRET_PROVENANCE_FIELD]: {
            version: 1,
            complete: false,
            entries: [],
          },
        },
        { ...context, headers }
      )
    ).rejects.toMatchObject({
      status: 400,
      body: { success: false, error: 'Model input provenance is unavailable' },
    })
    expect(mocks.assertToolFileAccess).not.toHaveBeenCalled()
    expect(mocks.analyzeVision).not.toHaveBeenCalled()
  })

  it('rejects unsafe files before reading bytes', async () => {
    mocks.isModelSafeWorkspaceFileKey.mockResolvedValue(false)

    await expect(
      executeVisionOperation(
        { apiKey: 'secret', imageFile, model: 'gpt-5.2', prompt: null },
        context
      )
    ).rejects.toMatchObject({
      status: 400,
      body: {
        success: false,
        error: 'File cannot be sent to a model because its secret provenance is unavailable',
      },
    })
    expect(mocks.downloadFileFromStorage).not.toHaveBeenCalled()
    expect(mocks.analyzeVision).not.toHaveBeenCalled()
  })

  it('uses the file over a simultaneous URL', async () => {
    await executeVisionOperation(
      {
        apiKey: 'secret',
        imageFile,
        imageUrl: 'https://ignored.example.com/image.png',
        model: 'gpt-5.2',
        prompt: 'Describe it',
      },
      context
    )

    expect(mocks.validateUrlWithDNS).not.toHaveBeenCalled()
    expect(mocks.analyzeVision).toHaveBeenCalledWith(
      expect.objectContaining({ imageSource: 'data:image/png;base64,AQID' }),
      undefined
    )
  })

  it('preserves v1 data URL inputs without treating them as network destinations', async () => {
    await executeVisionOperation(
      {
        apiKey: 'secret',
        imageUrl: 'data:image/png;base64,AQID',
        imageFile: null,
        model: 'gpt-5.2',
        prompt: 'Describe it',
      },
      context
    )

    expect(mocks.validateUrlWithDNS).not.toHaveBeenCalled()
    expect(mocks.analyzeVision).toHaveBeenCalledWith(
      expect.objectContaining({ imageSource: 'data:image/png;base64,AQID' }),
      undefined
    )
  })

  it('resolves internal URLs, checks model-safe provenance, then pins DNS', async () => {
    await executeVisionOperation(
      {
        apiKey: 'secret',
        imageUrl: '/api/files/serve/s3/workspace/workspace-1/image.png',
        imageFile: null,
        model: 'gemini-2.5-pro',
        prompt: 'Describe it',
      },
      context
    )

    expect(mocks.resolveInternalFileUrl).toHaveBeenCalledWith(
      '/api/files/serve/s3/workspace/workspace-1/image.png',
      'user-1',
      'request-1',
      expect.anything()
    )
    expect(mocks.isModelSafeWorkspaceFileKey).toHaveBeenCalledWith(
      'workspace/workspace-1/image.png'
    )
    expect(mocks.validateUrlWithDNS).toHaveBeenCalledWith(
      'https://storage.example.com/image.png',
      'imageUrl'
    )
    expect(mocks.analyzeVision).toHaveBeenCalledWith(
      expect.objectContaining({
        imageSource: 'https://storage.example.com/image.png',
        remoteImageResolvedIP: '203.0.113.10',
      }),
      undefined
    )
  })

  it('rejects invalid external destinations before provider work', async () => {
    mocks.validateUrlWithDNS.mockResolvedValue({ isValid: false, error: 'private address' })

    await expect(
      executeVisionOperation(
        {
          apiKey: 'secret',
          imageUrl: 'http://127.0.0.1/image.png',
          imageFile: null,
          model: 'gpt-5.2',
          prompt: null,
        },
        context
      )
    ).rejects.toMatchObject({
      status: 400,
      body: { success: false, error: 'private address' },
    })
    expect(mocks.analyzeVision).not.toHaveBeenCalled()
  })
})

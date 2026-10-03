import {
  fileUtilsServerMock,
  fileUtilsServerMockFns,
} from '@sim/testing/mocks/file-utils-server.mock'
import {
  filesAuthorizationMock,
  filesAuthorizationMockFns,
} from '@sim/testing/mocks/files-authorization.mock'
import {
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing/mocks/input-validation.mock'
import {
  workspaceFileSecretProvenanceMock,
  workspaceFileSecretProvenanceMockFns,
} from '@sim/testing/mocks/workspace-file-secret-provenance.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PRIVATE_MODEL_INPUT_PROVENANCE_HEADER } from '@/lib/execution/model-input-provenance'
import {
  RESOLVED_SECRET_PROVENANCE_FIELD,
  RESOLVED_SECRET_PROVENANCE_METADATA_V1,
} from '@/lib/execution/private-tool-metadata'

const mocks = vi.hoisted(() => ({
  analyzeVision: vi.fn(),
}))

vi.mock('@/lib/internal/vision/client', () => ({ analyzeVision: mocks.analyzeVision }))
vi.mock('@/app/api/files/authorization', () => filesAuthorizationMock)
vi.mock('@/lib/uploads/utils/file-utils.server', () => fileUtilsServerMock)
vi.mock(
  '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance',
  () => workspaceFileSecretProvenanceMock
)
vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

import { executeVisionOperation } from '@/lib/internal/vision/operations'

const { mockAssertToolFileAccess } = filesAuthorizationMockFns
const { mockDownloadFileFromStorage, mockResolveInternalFileUrl } = fileUtilsServerMockFns
const { mockIsModelSafeWorkspaceFileKey } = workspaceFileSecretProvenanceMockFns
const { mockValidateUrlWithDNS } = inputValidationMockFns

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
    mocks.analyzeVision.mockResolvedValue({ content: 'A lighthouse', model: 'gpt-5.2' })
    mockAssertToolFileAccess.mockResolvedValue(null)
    mockDownloadFileFromStorage.mockResolvedValue(Buffer.from([1, 2, 3]))
    mockIsModelSafeWorkspaceFileKey.mockResolvedValue(true)
    mockResolveInternalFileUrl.mockResolvedValue({
      fileUrl: 'https://storage.example.com/image.png',
    })
    mockValidateUrlWithDNS.mockResolvedValue({
      isValid: true,
      resolvedIP: '203.0.113.10',
    })
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
    expect(mockAssertToolFileAccess).not.toHaveBeenCalled()
    expect(mocks.analyzeVision).not.toHaveBeenCalled()
  })

  it('rejects unsafe files before reading bytes', async () => {
    mockIsModelSafeWorkspaceFileKey.mockResolvedValue(false)

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
    expect(mockDownloadFileFromStorage).not.toHaveBeenCalled()
    expect(mocks.analyzeVision).not.toHaveBeenCalled()
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

    expect(mockValidateUrlWithDNS).not.toHaveBeenCalled()
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

    expect(mockResolveInternalFileUrl).toHaveBeenCalledWith(
      '/api/files/serve/s3/workspace/workspace-1/image.png',
      'user-1',
      'request-1',
      expect.anything()
    )
    expect(mockIsModelSafeWorkspaceFileKey).toHaveBeenCalledWith('workspace/workspace-1/image.png')
    // A resolved internal file URL is a presigned URL against Sim's own
    // storage, which on a self-hosted deployment legitimately sits on a private
    // address — so it is judged as a configured endpoint, not as content.
    expect(mockValidateUrlWithDNS).toHaveBeenCalledWith(
      'https://storage.example.com/image.png',
      'imageUrl',
      'configuredEndpoint'
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
    mockValidateUrlWithDNS.mockResolvedValue({ isValid: false, error: 'private address' })

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

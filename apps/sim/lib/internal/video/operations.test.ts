import {
  filesAuthorizationMock,
  filesAuthorizationMockFns,
} from '@sim/testing/mocks/files-authorization.mock'
import { storageServiceMockFns } from '@sim/testing/mocks/storage-service.mock'
import { uploadsMock } from '@sim/testing/mocks/uploads.mock'
import {
  uploadsExecutionMock,
  uploadsExecutionMockFns,
} from '@sim/testing/mocks/uploads-execution.mock'
import {
  workspaceFileSecretProvenanceMock,
  workspaceFileSecretProvenanceMockFns,
} from '@sim/testing/mocks/workspace-file-secret-provenance.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  generateVideo: vi.fn(),
  validateOpaqueModelInputProvenance: vi.fn(),
}))

vi.mock('@/app/api/files/authorization', () => filesAuthorizationMock)
vi.mock('@/lib/execution/model-input-provenance', () => ({
  validateOpaqueModelInputProvenance: mocks.validateOpaqueModelInputProvenance,
}))
vi.mock('@/lib/internal/video/client', () => ({
  generateVideo: mocks.generateVideo,
  getVideoInputValidationError: vi.fn().mockReturnValue(undefined),
}))
vi.mock('@/lib/uploads', () => uploadsMock)
vi.mock('@/lib/uploads/contexts/execution', () => uploadsExecutionMock)
vi.mock(
  '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance',
  () => workspaceFileSecretProvenanceMock
)

import { executeVideoOperation } from '@/lib/internal/video/operations'

const { mockUploadExecutionFile } = uploadsExecutionMockFns

const { mockAssertToolFileAccess } = filesAuthorizationMockFns
const { mockIsModelSafeWorkspaceFileKey } = workspaceFileSecretProvenanceMockFns

const { mockUploadFile } = storageServiceMockFns

const file = {
  id: 'file-1',
  name: 'reference.png',
  size: 5,
  type: 'image/png',
  key: 'workspace/workspace-1/reference.png',
}

describe('executeVideoOperation', () => {
  beforeEach(() => {
    mockAssertToolFileAccess.mockResolvedValue(null)
    mockIsModelSafeWorkspaceFileKey.mockResolvedValue(true)
    mocks.validateOpaqueModelInputProvenance.mockReturnValue({ success: true })
    mocks.generateVideo.mockResolvedValue({
      buffer: Buffer.from('video'),
      width: 1280,
      height: 720,
      duration: 5,
      jobId: 'job-1',
    })
    mockUploadExecutionFile.mockResolvedValue({
      ...file,
      name: 'video.mp4',
      type: 'video/mp4',
      url: '/api/files/serve/video.mp4',
    })
  })

  it('fails opaque provenance before inspecting or downloading a Runway file', async () => {
    mocks.validateOpaqueModelInputProvenance.mockReturnValue({
      success: false,
      error: 'Model input provenance is unavailable',
      status: 400,
    })

    await expect(
      executeVideoOperation(
        {
          provider: 'runway',
          apiKey: 'key',
          prompt: 'A cinematic sunrise',
          visualReference: file,
        },
        { headers: new Headers(), requestId: 'request-1', userId: 'user-1' }
      )
    ).rejects.toMatchObject({ status: 400, message: 'Model input provenance is unavailable' })
    expect(mockAssertToolFileAccess).not.toHaveBeenCalled()
    expect(mocks.generateVideo).not.toHaveBeenCalled()
  })

  it('fails closed for model-unsafe workspace files', async () => {
    mockIsModelSafeWorkspaceFileKey.mockResolvedValue(false)

    await expect(
      executeVideoOperation(
        {
          provider: 'runway',
          apiKey: 'key',
          prompt: 'A cinematic sunrise',
          visualReference: file,
        },
        { headers: new Headers(), requestId: 'request-1', userId: 'user-1' }
      )
    ).rejects.toMatchObject({
      status: 400,
      message: 'File cannot be sent to a model because its secret provenance is unavailable',
    })
    expect(mocks.generateVideo).not.toHaveBeenCalled()
  })

  it('preserves Fal.ai hosted cost metadata', async () => {
    mocks.generateVideo.mockResolvedValue({
      buffer: Buffer.from('video'),
      falaiCost: {
        endpointId: 'fal-ai/veo3.1',
        requestId: 'fal-request-1',
        costDollars: 0.4,
        source: 'billing_events',
      },
    })
    mockUploadFile.mockResolvedValue({ path: '/api/files/video.mp4', size: 5 })

    const result = await executeVideoOperation(
      {
        provider: 'falai',
        apiKey: 'key',
        model: 'veo-3.1',
        prompt: 'A cinematic sunrise',
        useHostedCostTracking: true,
      },
      { headers: new Headers(), requestId: 'request-1', userId: 'user-1' }
    )

    expect(result.__falaiCostDollars).toBe(0.4)
    expect(result.__falaiBilling).toMatchObject({ source: 'billing_events' })
  })
})

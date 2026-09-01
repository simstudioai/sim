/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  assertToolFileAccess: vi.fn(),
  generateVideo: vi.fn(),
  isModelSafeWorkspaceFileKey: vi.fn(),
  uploadExecutionFile: vi.fn(),
  uploadFile: vi.fn(),
  validateOpaqueModelInputProvenance: vi.fn(),
}))

vi.mock('@/app/api/files/authorization', () => ({
  assertToolFileAccess: mocks.assertToolFileAccess,
}))
vi.mock('@/lib/execution/model-input-provenance', () => ({
  validateOpaqueModelInputProvenance: mocks.validateOpaqueModelInputProvenance,
}))
vi.mock('@/lib/internal/video/client', () => ({
  generateVideo: mocks.generateVideo,
  getVideoInputValidationError: vi.fn().mockReturnValue(undefined),
}))
vi.mock('@/lib/uploads', () => ({
  StorageService: { uploadFile: mocks.uploadFile },
}))
vi.mock('@/lib/uploads/contexts/execution', () => ({
  uploadExecutionFile: mocks.uploadExecutionFile,
}))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-secret-provenance', () => ({
  isModelSafeWorkspaceFileKey: mocks.isModelSafeWorkspaceFileKey,
  MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE:
    'File cannot be sent to a model because its secret provenance is unavailable',
}))

import { executeVideoOperation } from '@/lib/internal/video/operations'

const file = {
  id: 'file-1',
  name: 'reference.png',
  size: 5,
  type: 'image/png',
  key: 'workspace/workspace-1/reference.png',
}

describe('executeVideoOperation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.assertToolFileAccess.mockResolvedValue(null)
    mocks.isModelSafeWorkspaceFileKey.mockResolvedValue(true)
    mocks.validateOpaqueModelInputProvenance.mockReturnValue({ success: true })
    mocks.generateVideo.mockResolvedValue({
      buffer: Buffer.from('video'),
      width: 1280,
      height: 720,
      duration: 5,
      jobId: 'job-1',
    })
    mocks.uploadExecutionFile.mockResolvedValue({
      ...file,
      name: 'video.mp4',
      type: 'video/mp4',
      url: '/api/files/serve/video.mp4',
    })
  })

  it('uses trusted execution scope and returns the legacy output contract', async () => {
    const controller = new AbortController()
    const result = await executeVideoOperation(
      {
        provider: 'runway',
        apiKey: 'key',
        model: 'gen-4-turbo',
        prompt: 'A cinematic sunrise',
        visualReference: file,
      },
      {
        headers: new Headers(),
        requestId: 'request-1',
        signal: controller.signal,
        userId: 'user-1',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
      }
    )

    expect(mocks.validateOpaqueModelInputProvenance).toHaveBeenCalled()
    expect(mocks.assertToolFileAccess).toHaveBeenCalledWith(
      file.key,
      'user-1',
      'request-1',
      expect.anything()
    )
    expect(mocks.generateVideo).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'runway', visualReference: file }),
      { requestId: 'request-1', signal: controller.signal }
    )
    expect(mocks.uploadExecutionFile).toHaveBeenCalledWith(
      {
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
      },
      Buffer.from('video'),
      expect.stringMatching(/^video-runway-/),
      'video/mp4',
      'user-1'
    )
    expect(result).toMatchObject({
      videoUrl: '/api/files/serve/video.mp4',
      videoFile: expect.objectContaining({ type: 'video/mp4' }),
      duration: 5,
      width: 1280,
      height: 720,
      provider: 'runway',
      model: 'gen-4-turbo',
      jobId: 'job-1',
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
    expect(mocks.assertToolFileAccess).not.toHaveBeenCalled()
    expect(mocks.generateVideo).not.toHaveBeenCalled()
  })

  it('fails closed for model-unsafe workspace files', async () => {
    mocks.isModelSafeWorkspaceFileKey.mockResolvedValue(false)

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
    mocks.uploadFile.mockResolvedValue({ path: '/api/files/video.mp4', size: 5 })

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

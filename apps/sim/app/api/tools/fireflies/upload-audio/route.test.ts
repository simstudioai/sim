/**
 * @vitest-environment node
 */
import { createMockRequest, hybridAuthMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PRIVATE_MODEL_INPUT_PROVENANCE_HEADER } from '@/lib/execution/model-input-provenance'
import {
  RESOLVED_SECRET_PROVENANCE_FIELD,
  RESOLVED_SECRET_PROVENANCE_METADATA_V1,
} from '@/lib/execution/private-tool-metadata'

const { mockResolveFileInputToUrl } = vi.hoisted(() => ({
  mockResolveFileInputToUrl: vi.fn(),
}))

vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  resolveFileInputToUrl: mockResolveFileInputToUrl,
}))

import { POST } from '@/app/api/tools/fireflies/upload-audio/route'

const upstreamSuccess = {
  data: {
    uploadAudio: {
      success: true,
      title: 'Uploaded meeting',
      message: 'Queued',
    },
  },
}

describe('POST /api/tools/fireflies/upload-audio', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hybridAuthMockFns.mockCheckInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: 'internal_jwt',
    })
    mockResolveFileInputToUrl.mockResolvedValue({
      fileUrl: 'https://media.example.com/audio.mp3',
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json(upstreamSuccess, { status: 200 }))
    )
  })

  it('keeps headerless external URL calls compatible and preserves the GraphQL response', async () => {
    const response = await POST(
      createMockRequest('POST', {
        apiKey: 'fireflies-key',
        audioUrl: 'https://media.example.com/audio.mp3',
        title: 'Uploaded meeting',
        attendees: [{ displayName: 'Ada', email: 'ada@example.com' }],
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(upstreamSuccess)
    expect(mockResolveFileInputToUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: 'https://media.example.com/audio.mp3',
        userId: 'user-1',
        modelEgress: true,
        presignExpirySeconds: 3600,
      })
    )
    expect(fetch).toHaveBeenCalledWith(
      'https://api.fireflies.ai/graphql',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer fireflies-key',
        },
      })
    )
    const init = vi.mocked(fetch).mock.calls[0][1]
    const upstreamBody = JSON.parse(String(init?.body))
    expect(upstreamBody.variables.input).toEqual({
      url: 'https://media.example.com/audio.mp3',
      title: 'Uploaded meeting',
      attendees: [{ displayName: 'Ada', email: 'ada@example.com' }],
    })
  })

  it('rejects an incomplete private provenance envelope before resolving the source', async () => {
    const response = await POST(
      createMockRequest(
        'POST',
        {
          apiKey: 'fireflies-key',
          audioUrl: 'https://media.example.com/audio.mp3',
          [RESOLVED_SECRET_PROVENANCE_FIELD]: {
            version: 1,
            complete: false,
            entries: [],
          },
        },
        { [PRIVATE_MODEL_INPUT_PROVENANCE_HEADER]: RESOLVED_SECRET_PROVENANCE_METADATA_V1 }
      )
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      errors: [{ message: 'Model input provenance is unavailable' }],
    })
    expect(mockResolveFileInputToUrl).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects a model-unsafe stored file before contacting Fireflies', async () => {
    mockResolveFileInputToUrl.mockResolvedValueOnce({
      error: {
        status: 400,
        message: 'File cannot be sent to a model because its secret provenance is unavailable',
      },
    })

    const response = await POST(
      createMockRequest('POST', {
        apiKey: 'fireflies-key',
        audioFile: {
          key: 'workspace/workspace-1/audio.mp3',
          name: 'audio.mp3',
          size: 42,
          type: 'audio/mpeg',
        },
      })
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      errors: [
        {
          message: 'File cannot be sent to a model because its secret provenance is unavailable',
        },
      ],
    })
    expect(mockResolveFileInputToUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        file: expect.objectContaining({
          key: 'workspace/workspace-1/audio.mp3',
          name: 'audio.mp3',
          size: 42,
        }),
        modelEgress: true,
      })
    )
    expect(fetch).not.toHaveBeenCalled()
  })

  it('normalizes legacy key-only files and submits a fresh signed URL', async () => {
    mockResolveFileInputToUrl.mockResolvedValueOnce({
      fileUrl: 'https://storage.example.com/signed-audio.mp3',
    })

    const response = await POST(
      createMockRequest(
        'POST',
        {
          apiKey: 'fireflies-key',
          audioFile: { key: 'workspace/workspace-1/audio.mp3' },
          [RESOLVED_SECRET_PROVENANCE_FIELD]: {
            version: 1,
            complete: true,
            entries: [],
          },
        },
        { [PRIVATE_MODEL_INPUT_PROVENANCE_HEADER]: RESOLVED_SECRET_PROVENANCE_METADATA_V1 }
      )
    )

    expect(response.status).toBe(200)
    expect(mockResolveFileInputToUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        file: expect.objectContaining({
          key: 'workspace/workspace-1/audio.mp3',
          name: 'audio',
          size: 0,
        }),
        presignExpirySeconds: 3600,
        modelEgress: true,
      })
    )
    const init = vi.mocked(fetch).mock.calls[0][1]
    expect(JSON.parse(String(init?.body)).variables.input.url).toBe(
      'https://storage.example.com/signed-audio.mp3'
    )
  })
})

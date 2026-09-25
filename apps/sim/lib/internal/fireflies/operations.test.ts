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

import { executeFirefliesUploadAudio } from '@/lib/internal/fireflies/operations'

const upstreamSuccess = {
  data: { uploadAudio: { success: true, title: 'Uploaded meeting', message: 'Queued' } },
}

function createContext(headers = new Headers()) {
  return { headers, userId: 'user-1', requestId: 'request-1' }
}

describe('executeFirefliesUploadAudio', () => {
  beforeEach(() => {
    mockResolveFileInputToUrl.mockResolvedValue({
      fileUrl: 'https://media.example.com/audio.mp3',
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(upstreamSuccess)))
  })

  it('rejects incomplete private provenance before file resolution', async () => {
    const headers = new Headers({
      [PRIVATE_MODEL_INPUT_PROVENANCE_HEADER]: RESOLVED_SECRET_PROVENANCE_METADATA_V1,
    })
    const response = await executeFirefliesUploadAudio(
      {
        apiKey: 'fireflies-key',
        audioUrl: 'https://media.example.com/audio.mp3',
        [RESOLVED_SECRET_PROVENANCE_FIELD]: { version: 1, complete: false, entries: [] },
      },
      createContext(headers)
    )

    expect(response.status).toBe(400)
    expect(mockResolveFileInputToUrl).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('normalizes key-only stored files before model-safe URL resolution', async () => {
    const headers = new Headers({
      [PRIVATE_MODEL_INPUT_PROVENANCE_HEADER]: RESOLVED_SECRET_PROVENANCE_METADATA_V1,
    })
    const response = await executeFirefliesUploadAudio(
      {
        apiKey: 'fireflies-key',
        audioFile: { key: 'workspace/workspace-1/audio.mp3' },
        [RESOLVED_SECRET_PROVENANCE_FIELD]: { version: 1, complete: true, entries: [] },
      },
      createContext(headers)
    )

    expect(response.status).toBe(200)
    expect(mockResolveFileInputToUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        file: expect.objectContaining({ name: 'audio', size: 0 }),
        modelEgress: true,
        presignExpirySeconds: 3600,
      })
    )
  })
})

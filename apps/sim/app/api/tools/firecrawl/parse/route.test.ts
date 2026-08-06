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

const { mockDownloadServableFile, mockIsModelSafeWorkspaceFileKey } = vi.hoisted(() => ({
  mockDownloadServableFile: vi.fn(),
  mockIsModelSafeWorkspaceFileKey: vi.fn(),
}))

vi.mock('@/app/api/files/authorization', () => ({
  assertToolFileAccess: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadServableFileFromStorage: mockDownloadServableFile,
}))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-secret-provenance', () => ({
  isModelSafeWorkspaceFileKey: mockIsModelSafeWorkspaceFileKey,
  MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE:
    'File cannot be sent to a model because its secret provenance is unavailable',
}))

import { POST } from '@/app/api/tools/firecrawl/parse/route'

const PDF_FILE = {
  key: 'workspace/workspace-1/report.pdf',
  name: 'report.pdf',
  size: 4,
  type: 'application/pdf',
}

describe('POST /api/tools/firecrawl/parse', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hybridAuthMockFns.mockCheckInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: 'internal_jwt',
    })
    mockIsModelSafeWorkspaceFileKey.mockResolvedValue(true)
    mockDownloadServableFile.mockResolvedValue({
      buffer: Buffer.from('pdf'),
      contentType: 'application/pdf',
    })
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ success: true, data: { markdown: '# Parsed' } }, { status: 200 })
        )
    )
  })

  it('does not apply model provenance guards to explicit text-only PDF parsing', async () => {
    const response = await POST(
      createMockRequest(
        'POST',
        {
          apiKey: 'firecrawl-key',
          file: PDF_FILE,
          options: {
            formats: ['markdown'],
            parsers: [{ type: 'pdf', mode: 'fast' }],
          },
          [RESOLVED_SECRET_PROVENANCE_FIELD]: {
            version: 1,
            complete: false,
            entries: [],
          },
        },
        { [PRIVATE_MODEL_INPUT_PROVENANCE_HEADER]: RESOLVED_SECRET_PROVENANCE_METADATA_V1 }
      )
    )

    expect(response.status).toBe(200)
    expect(mockIsModelSafeWorkspaceFileKey).not.toHaveBeenCalled()
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('rejects incomplete provenance when summary generation is requested', async () => {
    const response = await POST(
      createMockRequest(
        'POST',
        {
          apiKey: 'firecrawl-key',
          file: { ...PDF_FILE, name: 'report.docx', type: 'application/vnd.ms-word' },
          options: { formats: ['summary'] },
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
      success: false,
      error: 'Model input provenance is unavailable',
    })
    expect(mockDownloadServableFile).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('applies durable file provenance to the default PDF auto parser', async () => {
    mockIsModelSafeWorkspaceFileKey.mockResolvedValueOnce(false)
    const response = await POST(
      createMockRequest(
        'POST',
        {
          apiKey: 'firecrawl-key',
          file: PDF_FILE,
          options: { formats: ['markdown'] },
          [RESOLVED_SECRET_PROVENANCE_FIELD]: {
            version: 1,
            complete: true,
            entries: [],
          },
        },
        { [PRIVATE_MODEL_INPUT_PROVENANCE_HEADER]: RESOLVED_SECRET_PROVENANCE_METADATA_V1 }
      )
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      success: false,
      error: 'File cannot be sent to a model because its secret provenance is unavailable',
    })
    expect(mockIsModelSafeWorkspaceFileKey).toHaveBeenCalledWith(PDF_FILE.key)
    expect(mockDownloadServableFile).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })
})

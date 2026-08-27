/**
 * @vitest-environment node
 */
import {
  createMockRequest,
  hybridAuthMockFns,
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { PRIVATE_MODEL_INPUT_PROVENANCE_HEADER } from '@/lib/execution/model-input-provenance'
import {
  RESOLVED_SECRET_PROVENANCE_FIELD,
  RESOLVED_SECRET_PROVENANCE_METADATA_V1,
} from '@/lib/execution/private-tool-metadata'
import { MISTRAL_OCR_REQUEST_POLICY } from '@/lib/knowledge/documents/ocr-request-policy'

const { mockDownloadServableFile, mockIsModelSafeWorkspaceFileKey } = vi.hoisted(() => ({
  mockDownloadServableFile: vi.fn(),
  mockIsModelSafeWorkspaceFileKey: vi.fn(),
}))

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)
vi.mock('@/app/api/files/authorization', () => ({
  assertToolFileAccess: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadServableFileFromStorage: mockDownloadServableFile,
  resolveInternalFileUrl: vi.fn(),
}))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-secret-provenance', () => ({
  isModelSafeWorkspaceFileKey: mockIsModelSafeWorkspaceFileKey,
  MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE:
    'File cannot be sent to a model because its secret provenance is unavailable',
}))

import { POST } from '@/app/api/tools/mistral/parse/route'

const PDF_FILE = {
  key: 'workspace/workspace-1/document.pdf',
  name: 'document.pdf',
  size: 3,
  type: 'application/pdf',
}

function createVerifiedRequest() {
  return createMockRequest(
    'POST',
    {
      apiKey: 'mistral-key',
      file: PDF_FILE,
      [RESOLVED_SECRET_PROVENANCE_FIELD]: {
        version: 1,
        complete: true,
        entries: [],
      },
    },
    { [PRIVATE_MODEL_INPUT_PROVENANCE_HEADER]: RESOLVED_SECRET_PROVENANCE_METADATA_V1 }
  )
}

describe('POST /api/tools/mistral/parse', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hybridAuthMockFns.mockCheckInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: 'internal_jwt',
    })
    inputValidationMockFns.mockValidateUrlWithDNS.mockResolvedValue({
      isValid: true,
      resolvedIP: '93.184.216.34',
      originalHostname: 'api.mistral.ai',
    })
    mockIsModelSafeWorkspaceFileKey.mockResolvedValue(true)
    mockDownloadServableFile.mockResolvedValue({
      buffer: Buffer.from('pdf'),
      contentType: 'application/pdf',
    })
    inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValue(
      Response.json({ pages: [], usage_info: { pages_processed: 0 } })
    )
  })

  it('returns 413 when the input file exceeds Mistral request limits', async () => {
    mockDownloadServableFile.mockRejectedValueOnce(
      new PayloadSizeLimitError({
        label: 'storage file download',
        maxBytes: MISTRAL_OCR_REQUEST_POLICY.maxBytes,
        observedBytes: MISTRAL_OCR_REQUEST_POLICY.maxBytes + 1,
      })
    )

    const response = await POST(createVerifiedRequest())

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: `File exceeds Mistral OCR's ${MISTRAL_OCR_REQUEST_POLICY.maxBytes.toLocaleString()}-byte request limit`,
    })
    expect(inputValidationMockFns.mockSecureFetchWithPinnedIP).not.toHaveBeenCalled()
  })

  it('returns 502 when Mistral response bytes exceed the secure-fetch cap', async () => {
    const responseLimitError = new PayloadSizeLimitError({
      label: 'response body',
      maxBytes: 100,
      observedBytes: 101,
    })
    inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
      body: null,
      text: async () => {
        throw responseLimitError
      },
      json: async () => {
        throw responseLimitError
      },
      arrayBuffer: async () => {
        throw responseLimitError
      },
    })

    const response = await POST(createVerifiedRequest())

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Mistral API response exceeded the safe size limit',
    })
  })
})

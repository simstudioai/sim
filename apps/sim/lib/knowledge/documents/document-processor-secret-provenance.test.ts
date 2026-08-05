/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDownloadFileFromUrl, mockIsModelSafeWorkspaceFileKey } = vi.hoisted(() => ({
  mockDownloadFileFromUrl: vi.fn(),
  mockIsModelSafeWorkspaceFileKey: vi.fn(),
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-secret-provenance', () => ({
  isModelSafeWorkspaceFileKey: mockIsModelSafeWorkspaceFileKey,
  MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE:
    'File cannot be sent to a model because its secret provenance is unavailable',
}))

vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadFileFromUrl: mockDownloadFileFromUrl,
}))

import { env } from '@/lib/core/config/env'
import { processDocument } from '@/lib/knowledge/documents/document-processor'
import { runWithKnowledgeModelInputProvenance } from '@/lib/knowledge/model-input-provenance'

describe('knowledge document model-input provenance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(env, {
      OCR_PROVIDER: 'azure-mistral',
      OCR_AZURE_API_KEY: 'test-key',
      OCR_AZURE_ENDPOINT: 'https://example.openai.azure.com',
      OCR_AZURE_MODEL_NAME: 'mistral-ocr',
    })
  })

  it('rejects an unsafe workspace file before downloading or parsing its bytes', async () => {
    mockIsModelSafeWorkspaceFileKey.mockResolvedValue(false)

    await expect(
      processDocument(
        '/api/files/serve/workspace/workspace-1/opaque.txt?context=workspace',
        'opaque.txt',
        'text/plain',
        1024,
        200,
        100,
        'user-1',
        'workspace-1'
      )
    ).rejects.toThrow('secret provenance is unavailable')

    expect(mockIsModelSafeWorkspaceFileKey).toHaveBeenCalledWith(
      'workspace/workspace-1/opaque.txt',
      { workspaceId: 'workspace-1' }
    )
    expect(mockDownloadFileFromUrl).not.toHaveBeenCalled()
  })

  it('rejects secret-bearing opaque document bytes before external OCR', async () => {
    await expect(
      runWithKnowledgeModelInputProvenance(
        undefined,
        () =>
          processDocument(
            'https://example.com/secret.pdf',
            'secret.pdf',
            'application/pdf',
            1024,
            200,
            100,
            'user-1'
          ),
        { opaqueInputSafe: false }
      )
    ).rejects.toThrow('Knowledge model input could not be safely projected')

    expect(mockDownloadFileFromUrl).not.toHaveBeenCalled()
  })
})

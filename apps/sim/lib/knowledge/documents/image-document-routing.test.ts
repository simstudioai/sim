/**
 * Images reach the vision extractor only from a source that declares the
 * semantic policy; every other image keeps the OCR path it had before.
 */

import { authInternalMock, authInternalMockFns } from '@sim/testing/mocks/auth-internal.mock'
import { fileParsersMock } from '@sim/testing/mocks/file-parsers.mock'
import {
  fileUtilsServerMock,
  fileUtilsServerMockFns,
} from '@sim/testing/mocks/file-utils-server.mock'
import { urlsMockFns } from '@sim/testing/mocks/urls.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockExecuteMistralParse, mockExtractImageText } = vi.hoisted(() => ({
  mockExecuteMistralParse: vi.fn(),
  mockExtractImageText: vi.fn(),
}))

vi.mock('@/lib/core/rate-limiter/provider-admission', () => ({
  PROVIDER_QUOTA_COOLDOWN_MS: 300_000,
  ProviderQuotaExhaustedError: class ProviderQuotaExhaustedError extends Error {},
  ProviderAdmissionTimeoutError: class ProviderAdmissionTimeoutError extends Error {},
  ProviderAdmissionStorageError: class ProviderAdmissionStorageError extends Error {},
  isProviderQuotaExhausted: vi.fn().mockResolvedValue(false),
  recordProviderCooldown: vi.fn().mockResolvedValue(undefined),
  waitForProviderAdmission: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/auth/internal', () => authInternalMock)
vi.mock('@/lib/file-parsers', () => fileParsersMock)
vi.mock('@/lib/uploads/utils/file-utils.server', () => fileUtilsServerMock)
vi.mock('@/lib/internal/mistral/operations', () => ({
  executeMistralParse: mockExecuteMistralParse,
}))
vi.mock('@/lib/knowledge/documents/image-extraction', () => ({
  extractImageText: mockExtractImageText,
}))

import { env } from '@/lib/core/config/env'
import { processDocument } from '@/lib/knowledge/documents/document-processor'
import type { ImageExtractionPolicy } from '@/lib/knowledge/documents/image-extraction-policy'
import { runWithKnowledgeModelInputProvenance } from '@/lib/knowledge/model-input-provenance'

const IMAGE_URL = 'https://example.com/schedule.png'
const IMAGE_BYTES = Buffer.from('png bytes')
const onVisionUsage = vi.fn()

function process(policy: ImageExtractionPolicy | undefined, mimeType = 'image/png') {
  return runWithKnowledgeModelInputProvenance(
    undefined,
    () =>
      processDocument(IMAGE_URL, 'Schedule', mimeType, 1024, 200, 1, {
        userId: 'user-1',
        imageExtraction: policy,
        processingDeadlineAt: Date.now() + 600_000,
        onVisionUsage,
        ocrCheckpoint: { knowledgeBaseId: 'kb-1', documentId: 'doc-1', indexingPassId: 'pass-1' },
      }),
    { opaqueInputSafe: true }
  )
}

describe('image document routing', () => {
  beforeEach(() => {
    Object.assign(env, { OCR_PROVIDER: undefined, MISTRAL_API_KEY: undefined })
    fileUtilsServerMockFns.mockDownloadFileFromUrl.mockResolvedValue(IMAGE_BYTES)
    authInternalMockFns.mockGenerateInternalToken.mockResolvedValue('internal-token')
    urlsMockFns.mockGetInternalApiBaseUrl.mockReturnValue('http://sim.local')
    mockExtractImageText.mockResolvedValue({
      decorative: false,
      renderedText: 'Region: EMEA. Quarter: Q1. Launch date: March 3.',
    })
  })

  it('indexes a semantic-source image through the vision extractor without any OCR provider', async () => {
    const processed = await process('semantic')

    expect(mockExtractImageText).toHaveBeenCalledWith(
      expect.objectContaining({
        source: IMAGE_BYTES,
        filename: 'Schedule',
        checkpoint: { knowledgeBaseId: 'kb-1', documentId: 'doc-1', indexingPassId: 'pass-1' },
        onUsage: onVisionUsage,
      })
    )
    expect(mockExecuteMistralParse).not.toHaveBeenCalled()
    expect(processed.chunks.map((chunk) => chunk.text).join(' ')).toContain('Region: EMEA')
    expect(processed.metadata).toMatchObject({ processingMethod: 'vision-extract' })
  })

  it('completes a decorative image with no chunks instead of failing it as unreadable', async () => {
    mockExtractImageText.mockResolvedValue({ decorative: true, renderedText: '' })
    const processed = await process('semantic')
    expect(processed.chunks).toEqual([])
    expect(processed.metadata).toMatchObject({ chunkCount: 0 })
  })

  it('fails an informative image whose extraction came back empty', async () => {
    mockExtractImageText.mockResolvedValue({ decorative: false, renderedText: '' })
    await expect(process('semantic')).rejects.toMatchObject({ code: 'no_extractable_text' })
  })

  it.each([undefined, 'ocr'] as const)(
    'keeps an image from a source with policy %s on the OCR path',
    async (policy) => {
      await expect(process(policy)).rejects.toThrow('Configure Mistral or Azure OCR')
      expect(mockExtractImageText).not.toHaveBeenCalled()
    }
  )

  it('keeps an AVIF image on the OCR path even for a semantic source', async () => {
    await expect(process('semantic', 'image/avif')).rejects.toThrow(
      'Configure Mistral or Azure OCR'
    )
    expect(mockExtractImageText).not.toHaveBeenCalled()
  })
})

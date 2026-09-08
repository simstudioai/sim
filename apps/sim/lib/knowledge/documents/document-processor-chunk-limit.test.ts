/**
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockParseBuffer } = vi.hoisted(() => ({
  mockParseBuffer: vi.fn(),
}))

vi.mock('@/lib/core/rate-limiter/provider-admission', () => ({
  PROVIDER_QUOTA_COOLDOWN_MS: 300_000,
  ProviderQuotaExhaustedError: class ProviderQuotaExhaustedError extends Error {},
  isProviderQuotaExhausted: vi.fn().mockResolvedValue(false),
  recordProviderCooldown: vi.fn().mockResolvedValue(undefined),
  waitForProviderAdmission: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/file-parsers', () => ({
  parseBuffer: mockParseBuffer,
}))

import { ChunkLimitExceededError } from '@/lib/chunkers/chunk-budget'
import { TokenChunker } from '@/lib/chunkers/token-chunker'
import {
  MAX_DOCUMENT_CHUNKS,
  type PermanentDocumentProcessingError,
} from '@/lib/knowledge/documents/document-processing-error'
import { processDocument } from '@/lib/knowledge/documents/document-processor'

describe('document chunk production ceiling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('translates the shared chunk limit once into a permanent complexity failure', async () => {
    mockParseBuffer.mockResolvedValue({
      content: Array.from({ length: MAX_DOCUMENT_CHUNKS + 1 }, () => 'word').join(' '),
      metadata: {},
    })

    const processing = processDocument(
      'data:text/plain;base64,dGVzdA==',
      'large.txt',
      'text/plain',
      1,
      0,
      1,
      undefined,
      undefined,
      'token'
    )

    await expect(processing).rejects.toMatchObject({
      name: 'PermanentDocumentProcessingError',
      code: 'document_complexity_limit',
      cause: expect.any(ChunkLimitExceededError),
    } satisfies Partial<PermanentDocumentProcessingError>)
  })

  it('never completes nonempty content with zero chunks', async () => {
    mockParseBuffer.mockResolvedValue({ content: 'x', metadata: {} })
    vi.spyOn(TokenChunker.prototype, 'chunk').mockResolvedValue([])

    await expect(
      processDocument(
        'data:text/plain;base64,eA==',
        'filtered.txt',
        'text/plain',
        100,
        0,
        10,
        undefined,
        undefined,
        'token'
      )
    ).rejects.toMatchObject({
      name: 'PermanentDocumentProcessingError',
      code: 'no_extractable_text',
    } satisfies Partial<PermanentDocumentProcessingError>)
  })

  it('preserves bounded partial indexing for a parser-limited document', async () => {
    const content = 'name,value\nfirst,1\nsecond,2\n[Content truncated: showing first 1,000 rows]'
    mockParseBuffer.mockResolvedValue({
      content,
      metadata: { truncated: true, headers: ['name', 'value'], rowCount: 2_000 },
    })

    const result = await processDocument(
      'data:text/csv;base64,dGVzdA==',
      'large.csv',
      'text/csv',
      100,
      0,
      10
    )

    expect(result.chunks.length).toBeGreaterThan(0)
    expect(result.metadata.characterCount).toBe(content.length)
  })
})

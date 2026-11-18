import { jsonResponse } from '@sim/testing'
import {
  fileUtilsServerMock,
  fileUtilsServerMockFns,
} from '@sim/testing/mocks/file-utils-server.mock'
import {
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing/mocks/input-validation.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/uploads/utils/file.server', () => fileUtilsServerMock)
vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

const { mockResolveFileInputToUrl } = fileUtilsServerMockFns
const { mockSecureFetchWithPinnedIP, mockValidateUrlWithDNS } = inputValidationMockFns

import { ExtendOperationError } from '@/lib/internal/extend/errors'
import { executeExtendParse } from '@/lib/internal/extend/operations'

const context = { headers: new Headers(), requestId: 'req-1', userId: 'user-1' }
const input = { apiKey: 'key', filePath: 'https://files.example.com/doc.pdf' }

describe('executeExtendParse', () => {
  beforeEach(() => {
    mockResolveFileInputToUrl.mockResolvedValue({ fileUrl: 'https://files.example.com/doc.pdf' })
    mockValidateUrlWithDNS.mockResolvedValue({ isValid: true, resolvedIP: '203.0.113.1' })
  })

  it('reads the page count and credits from the parser run metrics and usage', async () => {
    mockSecureFetchWithPinnedIP.mockResolvedValue(
      jsonResponse({
        id: 'parser_run_1',
        status: 'PROCESSED',
        chunks: [],
        metrics: { processingTimeMs: 900, pageCount: 4 },
        usage: { credits: 8 },
      })
    )

    const result = await executeExtendParse(input, context)

    expect(result.output.pageCount).toBe(4)
    expect(result.output.creditsUsed).toBe(8)
  })

  it('fails with the failure reason when Extend could not parse the file', async () => {
    mockSecureFetchWithPinnedIP.mockResolvedValue(
      jsonResponse({
        id: 'parser_run_1',
        status: 'FAILED',
        failureReason: 'CORRUPT_FILE',
        chunks: [],
      })
    )

    await expect(executeExtendParse(input, context)).rejects.toEqual(
      new ExtendOperationError(422, {
        success: false,
        error: 'Extend could not parse the file: CORRUPT_FILE',
      })
    )
  })
})

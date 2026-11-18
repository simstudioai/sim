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

import { executeReductoParse } from '@/lib/internal/reducto/operations'

const context = { headers: new Headers(), requestId: 'req-1', userId: 'user-1' }

describe('executeReductoParse', () => {
  beforeEach(() => {
    mockResolveFileInputToUrl.mockResolvedValue({ fileUrl: 'https://files.example.com/doc.pdf' })
    mockValidateUrlWithDNS.mockResolvedValue({ isValid: true, resolvedIP: '203.0.113.1' })
    mockSecureFetchWithPinnedIP.mockResolvedValue(jsonResponse({ job_id: 'job-1' }))
  })

  it('parses only the requested pages, not every page between them', async () => {
    await executeReductoParse(
      { apiKey: 'key', filePath: 'https://files.example.com/doc.pdf', pages: [2, 9] },
      context
    )

    const [, , request] = mockSecureFetchWithPinnedIP.mock.calls[0]
    expect(JSON.parse(request.body).settings).toEqual({ page_range: [2, 9] })
  })
})

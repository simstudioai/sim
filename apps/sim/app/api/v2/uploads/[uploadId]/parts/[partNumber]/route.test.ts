/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  MockLocalUploadBodyError,
  mockExpectedUploadPartSize,
  mockVerifyUploadSessionToken,
  mockWriteLocalMultipartPart,
} = vi.hoisted(() => {
  class MockLocalUploadBodyError extends Error {}
  return {
    MockLocalUploadBodyError,
    mockExpectedUploadPartSize: vi.fn(),
    mockVerifyUploadSessionToken: vi.fn(),
    mockWriteLocalMultipartPart: vi.fn(),
  }
})

vi.mock('@/lib/uploads/upload-session/provider', () => ({
  LocalUploadBodyError: MockLocalUploadBodyError,
  writeLocalMultipartPart: mockWriteLocalMultipartPart,
}))

vi.mock('@/lib/uploads/upload-session/service', () => ({
  expectedUploadPartSize: mockExpectedUploadPartSize,
  verifyUploadSessionToken: mockVerifyUploadSessionToken,
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { PUT } from '@/app/api/v2/uploads/[uploadId]/parts/[partNumber]/route'

const SESSION = {
  id: 'upload-1',
  storageProvider: 'local',
  method: 'multipart',
  status: 'uploading',
  expiresAt: new Date('2999-01-01T00:00:00.000Z'),
  partSize: 3,
  partCount: 2,
} as const

describe('PUT /api/v2/uploads/[uploadId]/parts/[partNumber]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockVerifyUploadSessionToken.mockReturnValue(SESSION)
    mockExpectedUploadPartSize.mockReturnValue(3)
    mockWriteLocalMultipartPart.mockResolvedValue(undefined)
  })

  it('streams an exact-size local multipart part', async () => {
    const response = await request()

    expect(response.status).toBe(204)
    expect(mockVerifyUploadSessionToken).toHaveBeenCalledWith('signed-token')
    expect(mockExpectedUploadPartSize).toHaveBeenCalledWith(SESSION, 1)
    expect(mockWriteLocalMultipartPart).toHaveBeenCalledWith({
      uploadId: 'upload-1',
      partNumber: 1,
      body: expect.any(ReadableStream),
      expectedSize: 3,
    })
  })

  it('maps a streamed-size failure to 400', async () => {
    mockWriteLocalMultipartPart.mockRejectedValue(
      new MockLocalUploadBodyError('Part 1 has 2 bytes; expected 3')
    )

    const response = await request({ contentLength: null })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'BAD_REQUEST', message: 'Part 1 has 2 bytes; expected 3' },
    })
  })

  it('rejects PUT sessions before calculating a part size', async () => {
    mockVerifyUploadSessionToken.mockReturnValue({ ...SESSION, method: 'put' })

    const response = await request()

    expect(response.status).toBe(409)
    expect(mockExpectedUploadPartSize).not.toHaveBeenCalled()
    expect(mockWriteLocalMultipartPart).not.toHaveBeenCalled()
  })

  /**
   * The part number is a path segment of a session-scoped signed URL, so any
   * holder of a legitimate part URL can address a part the session does not
   * have. `expectedUploadPartSize` classifies that as a validation failure;
   * `service.test.ts` pins that classification on the real implementation,
   * which this suite mocks away.
   */
  it('maps an out-of-range part number to the documented 400', async () => {
    mockExpectedUploadPartSize.mockImplementation(() => {
      throw new OrchestrationError('validation', 'partNumber must be between 1 and 2')
    })

    const response = await request({ partNumber: '99' })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: { code: 'BAD_REQUEST', message: 'partNumber must be between 1 and 2' },
    })
    expect(mockWriteLocalMultipartPart).not.toHaveBeenCalled()
  })

  it('still renders an unclassified part-size failure as a generic 500', async () => {
    mockExpectedUploadPartSize.mockImplementation(() => {
      throw new Error('unexpected')
    })

    const response = await request()

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    })
    expect(mockWriteLocalMultipartPart).not.toHaveBeenCalled()
  })

  it('rejects expired upload sessions before writing the part', async () => {
    mockVerifyUploadSessionToken.mockReturnValue({
      ...SESSION,
      expiresAt: new Date('2000-01-01T00:00:00.000Z'),
    })

    const response = await request()

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: { code: 'CONFLICT', message: 'Upload session has expired' },
    })
    expect(mockExpectedUploadPartSize).not.toHaveBeenCalled()
    expect(mockWriteLocalMultipartPart).not.toHaveBeenCalled()
  })
})

function request(options?: { contentLength?: string | null; partNumber?: string }) {
  const headers = new Headers({ 'Content-Type': 'application/octet-stream' })
  if (options?.contentLength !== null) {
    headers.set('Content-Length', options?.contentLength ?? '3')
  }
  const partNumber = options?.partNumber ?? '1'
  return PUT(
    new NextRequest(
      `http://localhost:3000/api/v2/uploads/upload-1/parts/${partNumber}?token=signed-token`,
      {
        method: 'PUT',
        headers,
        body: new Uint8Array([1, 2, 3]),
      }
    ),
    { params: Promise.resolve({ uploadId: 'upload-1', partNumber }) }
  )
}

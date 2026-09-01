/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockReadResponseTextWithLimit, mockSecureFetch, MOCK_MAX_JSON_BYTES } = vi.hoisted(() => ({
  mockReadResponseTextWithLimit: vi.fn(),
  mockSecureFetch: vi.fn(),
  MOCK_MAX_JSON_BYTES: 10 * 1024 * 1024,
}))

vi.mock('@/lib/core/utils/stream-limits', () => {
  class PayloadSizeLimitError extends Error {
    observedBytes?: number
    constructor(message: string, observedBytes?: number) {
      super(message)
      this.name = 'PayloadSizeLimitError'
      this.observedBytes = observedBytes
    }
  }
  return {
    PayloadSizeLimitError,
    readResponseTextWithLimit: mockReadResponseTextWithLimit,
  }
})

vi.mock('@/lib/core/security/input-validation.server', () => ({
  secureFetchWithValidation: mockSecureFetch,
  MAX_JSON_API_RESPONSE_BYTES: MOCK_MAX_JSON_BYTES,
}))

import { readConcurApiBody, readConcurUploadBody } from '@/lib/internal/sap-concur/client'

/** Minimal response shape both helpers accept. */
function uploadResponse(status: number): Parameters<typeof readConcurUploadBody>[0] {
  return {
    status,
    headers: new Headers(),
    body: null,
  }
}

function apiResponse(
  status: number,
  text: () => Promise<string>
): Parameters<typeof readConcurApiBody>[0] {
  return { status, text }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockReadResponseTextWithLimit.mockReset()
})

/**
 * Both helpers make the same success/error split, so the cases are declared once and run
 * against each helper. `readConcurUploadBody` reads through the mocked
 * `readResponseTextWithLimit`; `readConcurApiBody` reads through `response.text()`.
 */
const helpers = [
  {
    name: 'readConcurUploadBody',
    read: (status: number, result: Promise<string>) => {
      mockReadResponseTextWithLimit.mockReturnValue(result)
      return readConcurUploadBody(uploadResponse(status))
    },
  },
  {
    name: 'readConcurApiBody',
    read: (status: number, result: Promise<string>) =>
      readConcurApiBody(apiResponse(status, () => result)),
  },
] as const

describe.each(helpers)('$name response body reads', ({ read }) => {
  it('resolves with the body text on a success status', async () => {
    await expect(read(200, Promise.resolve('{"id":"exp-1"}'))).resolves.toBe('{"id":"exp-1"}')
  })

  it('resolves with an empty string for an empty success body', async () => {
    await expect(read(200, Promise.resolve(''))).resolves.toBe('')
  })

  it('propagates a read failure on a success status', async () => {
    const failure = new Error('Concur upload response exceeded 10485760 bytes')
    await expect(read(201, Promise.reject(failure))).rejects.toBe(failure)
  })

  it('resolves with the body text on an error status', async () => {
    await expect(read(400, Promise.resolve('{"message":"Invalid userId"}'))).resolves.toBe(
      '{"message":"Invalid userId"}'
    )
  })

  it('swallows a read failure on a 4xx status', async () => {
    await expect(read(403, Promise.reject(new Error('stream aborted')))).resolves.toBe('')
  })

  it('swallows a read failure on a 5xx status', async () => {
    await expect(read(503, Promise.reject(new Error('stream aborted')))).resolves.toBe('')
  })

  /**
   * The source compares `status >= 200 && status < 300`, so 200 and 299 take the strict
   * path and 199 and 300 take the tolerant one.
   */
  it.each([200, 299])('treats %i as a success status', async (status) => {
    const failure = new Error('read failed')
    await expect(read(status, Promise.reject(failure))).rejects.toBe(failure)
  })

  it.each([199, 300])('treats %i as a non-success status', async (status) => {
    await expect(read(status, Promise.reject(new Error('read failed')))).resolves.toBe('')
  })
})

describe('readConcurUploadBody byte cap wiring', () => {
  it('reads under the shared JSON response byte cap', async () => {
    mockReadResponseTextWithLimit.mockReturnValue(Promise.resolve('{}'))
    const response = uploadResponse(200)

    await expect(readConcurUploadBody(response)).resolves.toBe('{}')

    expect(mockReadResponseTextWithLimit).toHaveBeenCalledWith(response, {
      maxBytes: MOCK_MAX_JSON_BYTES,
      label: 'Concur upload response',
    })
  })
})

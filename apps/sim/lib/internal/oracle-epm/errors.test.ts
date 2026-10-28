/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import type { SecureFetchResponse } from '@/lib/core/security/input-validation.server'
import {
  oracleEpmErrorFromResponse,
  validateOracleEpmCorrelationId,
} from '@/lib/internal/oracle-epm/errors'

function response(body: unknown, correlationId = 'req-123'): SecureFetchResponse {
  const encoded = new TextEncoder().encode(JSON.stringify(body))
  return {
    ok: false,
    status: 400,
    statusText: 'Bad Request',
    headers: {
      get: (name: string) => (name === 'x-request-id' ? correlationId : null),
    } as SecureFetchResponse['headers'],
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(encoded)
        controller.close()
      },
    }),
    text: async () => JSON.stringify(body),
    json: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
  }
}

describe('Oracle EPM public errors', () => {
  it('exposes only allowlisted codes and validated correlation ids', async () => {
    const error = await oracleEpmErrorFromResponse(
      response({
        code: 'SAFE_CODE',
        message: 'password=super-secret',
        detail: '<html>secret</html>',
      }),
      {
        providerCodePath: ['code'],
        allowedProviderCodes: ['SAFE_CODE'],
        correlationHeaders: ['x-request-id'],
      },
      false
    )
    expect(error).toMatchObject({
      category: 'invalid_input',
      status: 400,
      providerCode: 'SAFE_CODE',
      correlationId: 'req-123',
      retryable: false,
    })
    expect(JSON.stringify(error)).not.toContain('super-secret')
    expect(error.message).not.toContain('html')
  })

  it('drops arbitrary codes and malformed correlation ids', async () => {
    const error = await oracleEpmErrorFromResponse(
      response({ code: 'UNREVIEWED' }, 'token secret'),
      {
        providerCodePath: ['code'],
        allowedProviderCodes: ['SAFE_CODE'],
        correlationHeaders: ['x-request-id'],
      },
      false
    )
    expect(error.providerCode).toBeUndefined()
    expect(error.correlationId).toBeUndefined()
    expect(validateOracleEpmCorrelationId('x'.repeat(129))).toBeUndefined()
  })
})

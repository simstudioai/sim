import { describe, expect, it } from 'vitest'
import { getOcrResponseDiagnostic } from '@/lib/internal/mistral/error-diagnostics'

describe('OCR error diagnostics', () => {
  it.each([
    { code: 400, type: 'invalid_request_error', message: 'private document' },
    { error: { code: 400, type: 'invalid_request_error', message: 'private document' } },
  ])('projects only safe fields from a provider envelope', (body) => {
    expect(
      getOcrResponseDiagnostic(new Headers({ 'x-request-id': 'request_123' }), JSON.stringify(body))
    ).toEqual({
      bodyFormat: 'json',
      providerRequestId: 'request_123',
      providerErrorCode: '400',
      providerErrorType: 'invalid_request_error',
    })
  })

  it.each(['not json', '<html>private input</html>', '', 'null', '[]', '42'])(
    'tolerates an unavailable or non-object error: %s',
    (body) => {
      expect(getOcrResponseDiagnostic(new Headers(), body)).toMatchObject({
        providerRequestId: null,
        providerErrorCode: null,
        providerErrorType: null,
      })
    }
  )

  it('does not trust arbitrary codes, error types, echoed input, or request IDs', () => {
    const diagnostic = getOcrResponseDiagnostic(
      new Headers({ 'x-request-id': 'secret '.repeat(30), 'apim-request-id': 'safe-123' }),
      JSON.stringify({
        code: 'private_document',
        type: { input: 'private_document' },
        message: 'private_document',
        param: 'secret-key',
        detail: { input: 'private_document' },
      })
    )
    expect(diagnostic).toMatchObject({
      providerRequestId: 'safe-123',
      providerErrorCode: 'unrecognized',
      providerErrorType: 'unrecognized',
    })
    expect(JSON.stringify(diagnostic)).not.toMatch(/private_document|secret-key/)
  })
})

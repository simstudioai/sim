/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { getEmbeddingResponseDiagnostic } from '@/lib/embeddings/error-diagnostics'

describe('embedding response diagnostics', () => {
  it.each([
    ['model_not_found', 'invalid_request_error'],
    ['DeploymentNotFound', undefined],
    [404, 'NOT_FOUND'],
  ])('retains safe machine codes for %s without free-form provider text', (code, type) => {
    const diagnostic = getEmbeddingResponseDiagnostic(
      new Headers({ 'x-request-id': 'req_test', authorization: 'Bearer private-key' }),
      JSON.stringify({
        error: { code, type, message: 'private document', param: 'private input' },
      })
    )
    expect(diagnostic).toEqual({
      providerRequestId: 'req_test',
      bodyFormat: 'json',
      providerErrorCode: String(code),
      providerErrorType: type ?? null,
    })
    expect(JSON.stringify(diagnostic)).not.toContain('private')
  })

  it('reads Gemini status independently of its numeric error code', () => {
    expect(
      getEmbeddingResponseDiagnostic(
        new Headers(),
        JSON.stringify({ error: { code: 404, status: 'NOT_FOUND' } })
      )
    ).toMatchObject({ providerErrorCode: '404', providerErrorType: 'NOT_FOUND' })
  })

  it.each(['apim-request-id', 'x-ms-request-id'])('reads the Azure %s header', (header) => {
    expect(
      getEmbeddingResponseDiagnostic(new Headers({ [header]: 'request-test' }), '')
    ).toMatchObject({ providerRequestId: 'request-test', bodyFormat: 'unavailable' })
  })

  it.each(['', '<html>private gateway error</html>', '{"error":', 'null', '[]', '"private"'])(
    'tolerates an unavailable, non-JSON, or unexpected body: %s',
    (body) => {
      const diagnostic = getEmbeddingResponseDiagnostic(new Headers(), body)
      expect(diagnostic.providerErrorCode).toBeNull()
      expect(diagnostic.providerErrorType).toBeNull()
      expect(JSON.stringify(diagnostic)).not.toContain('private')
    }
  )

  it.each([
    'private-key',
    'private document text',
    { private: true },
    ['private'],
    'x'.repeat(1000),
  ])('does not copy unknown error fields into logs: %j', (value) => {
    expect(
      getEmbeddingResponseDiagnostic(
        new Headers(),
        JSON.stringify({ error: { code: value, type: value } })
      )
    ).toMatchObject({ providerErrorCode: 'unrecognized', providerErrorType: 'unrecognized' })
  })

  it.each(['Bearer private-key', 'https://private.example', 'x'.repeat(129)])(
    'omits malformed or oversized request IDs: %s',
    (requestId) => {
      expect(
        getEmbeddingResponseDiagnostic(new Headers({ 'x-request-id': requestId }), '')
          .providerRequestId
      ).toBeNull()
    }
  )
})

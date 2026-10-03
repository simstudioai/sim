import { describe, expect, it } from 'vitest'
import { getEmbeddingResponseDiagnostic } from '@/lib/embeddings/error-diagnostics'

describe('embedding response diagnostics', () => {
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

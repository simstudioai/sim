import { DrizzleQueryError } from 'drizzle-orm/errors'
import { describe, expect, it } from 'vitest'
import { EmbeddingAPIError } from '@/lib/embeddings/api-error'
import { getConnectorFailureDiagnostic } from '@/lib/knowledge/connectors/connector-error'

describe('connector failure diagnostics', () => {
  it('finds embedding failures through concurrent batches and nested cause wrappers', () => {
    const error = new Error('private outer wrapper', {
      cause: new AggregateError([
        new EmbeddingAPIError('private upstream message', 503),
        new Error('private inner wrapper', {
          cause: new AggregateError([new EmbeddingAPIError('private upstream message', 503)]),
        }),
        new Error('private sibling'),
      ]),
    })
    expect(getConnectorFailureDiagnostic(error)).toEqual({
      category: 'embedding',
      status: 503,
      message: 'Embedding service request failed (HTTP 503).',
    })
  })

  it('terminates cyclic aggregate wrappers and still finds an embedding sibling', () => {
    const error = new AggregateError([])
    error.errors.push(new EmbeddingAPIError('private upstream message', 429), error)
    error.cause = error
    expect(getConnectorFailureDiagnostic(error)).toMatchObject({
      category: 'embedding',
      status: 429,
    })
    const cycle = new AggregateError([])
    cycle.errors.push(cycle)
    expect(getConnectorFailureDiagnostic(cycle)).toBeNull()
  })

  it('bounds traversal of deeply nested aggregate wrappers', () => {
    let error: Error = new EmbeddingAPIError('private upstream message', 503)
    for (let i = 0; i < 40; i++) error = new AggregateError([error])
    expect(getConnectorFailureDiagnostic(error)).toBeNull()
  })

  it.each([401, 403, 404, 429, 502, 503])(
    'does not attribute a wrapped embedding HTTP %s to the source',
    (status) => {
      const error = new Error('private wrapper', {
        cause: new EmbeddingAPIError('private provider details', status),
      })
      expect(getConnectorFailureDiagnostic(error)).toEqual({
        category: 'embedding',
        status,
        message: `Embedding service request failed (HTTP ${status}).`,
      })
    }
  )

  it('retains the SQLSTATE while discarding SQL, bound values and driver detail', () => {
    const error = new DrizzleQueryError(
      'select private_column from private_source where id = $1',
      ['private-value'],
      Object.assign(new Error('private driver detail'), { code: '08006' })
    )
    expect(getConnectorFailureDiagnostic(error)).toEqual({
      category: 'database',
      code: '08006',
      message: 'Database request failed (SQLSTATE 08006).',
    })
  })

  it('suppresses query text even when the driver provides no error code', () => {
    expect(
      getConnectorFailureDiagnostic(new DrizzleQueryError('select private', ['private'], null))
    ).toEqual({
      category: 'database',
      message: 'Database request failed without a driver error code.',
    })
  })

  it('distinguishes a lost database connection from a source connection', () => {
    const socketError = Object.assign(new Error('private host'), { code: 'EPIPE' })
    expect(getConnectorFailureDiagnostic(socketError)).toMatchObject({
      category: 'transport',
      code: 'EPIPE',
    })
    expect(
      getConnectorFailureDiagnostic(new DrizzleQueryError('select private', [], socketError))
    ).toMatchObject({ category: 'database', code: 'EPIPE' })
  })

  it.each([
    [401, 'authorization'],
    [403, 'authorization'],
    [404, 'source_unavailable'],
    [410, 'source_unavailable'],
    [400, 'request_rejected'],
    [422, 'request_rejected'],
    [429, 'rate_limit'],
    [408, 'provider_unavailable'],
    [503, 'provider_unavailable'],
  ])('projects wrapped HTTP %s without the provider body', (status, category) => {
    const error = new Error('private wrapper', {
      cause: Object.assign(new Error('private response body'), { status }),
    })
    const diagnostic = getConnectorFailureDiagnostic(error)
    expect(diagnostic).toMatchObject({ status, category })
    expect(diagnostic?.message).toContain(`HTTP ${status}`)
    expect(JSON.stringify(diagnostic)).not.toContain('private')
  })

  it('does not infer status or permanence from a free-form message', () => {
    expect(getConnectorFailureDiagnostic(new Error('HTTP 403 permission denied'))).toBeNull()
    expect(
      getConnectorFailureDiagnostic(Object.assign(new Error('failure'), { status: 403.5 }))
    ).toBeNull()
    expect(
      getConnectorFailureDiagnostic(Object.assign(new Error('failure'), { code: 'private-value' }))
    ).toBeNull()
  })

  it('terminates a cyclic cause chain', () => {
    const error = new Error('cycle')
    error.cause = error
    expect(getConnectorFailureDiagnostic(error)).toBeNull()
  })
})

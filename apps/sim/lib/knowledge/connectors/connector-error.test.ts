/** @vitest-environment node */
import { DrizzleQueryError } from 'drizzle-orm/errors'
import { describe, expect, it } from 'vitest'
import { getConnectorFailureDiagnostic } from '@/lib/knowledge/connectors/connector-error'
import { GoogleDriveApiError } from '@/connectors/google-drive/google-drive-errors'

describe('connector failure diagnostics', () => {
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

  it('recognizes query wrappers from a different bundled driver instance', () => {
    const error = Object.assign(new Error('private query wrapper'), {
      query: 'select private',
      params: ['private'],
    })
    expect(getConnectorFailureDiagnostic(error)).toEqual({
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

  it.each([
    ['fileNotDownloadable', 'request_rejected'],
    ['fileNotExportable', 'request_rejected'],
    ['exportSizeLimitExceeded', 'request_rejected'],
    ['domainPolicy', 'request_rejected'],
    ['userRateLimitExceeded', 'rate_limit'],
    ['dailyLimitExceeded', 'rate_limit'],
    ['insufficientFilePermissions', 'authorization'],
  ])('preserves provider classification for HTTP 403 %s', (reason, category) => {
    const error = new Error('private wrapper', { cause: new GoogleDriveApiError(403, [reason]) })
    expect(getConnectorFailureDiagnostic(error)).toMatchObject({ status: 403, category })
    expect(JSON.stringify(getConnectorFailureDiagnostic(error))).not.toContain('private')
    if (category !== 'authorization')
      expect(getConnectorFailureDiagnostic(error)?.message).not.toContain('access was denied')
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

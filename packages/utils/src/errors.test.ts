/**
 * @vitest-environment node
 */

import {
  classifyDatabaseFailure,
  describeError,
  findCause,
  getPostgresCancellationReason,
  getPostgresErrorCode,
  getTransientDatabaseFailure,
  toError,
} from '@sim/utils/errors'
import { describe, expect, it } from 'vitest'

describe('getPostgresCancellationReason', () => {
  it.each([
    ['57014', 'canceling statement due to statement timeout', 'statement_timeout'],
    ['57014', 'canceling statement due to user request', 'user_cancel'],
    ['40001', 'canceling statement due to conflict with recovery', 'recovery_conflict'],
    ['55P03', 'canceling statement due to lock timeout', 'lock_timeout'],
    ['25P04', 'terminating connection due to transaction timeout', 'transaction_timeout'],
    ['40P01', 'deadlock detected', 'deadlock'],
  ])('identifies %s %s through query wrappers', (code, message, reason) => {
    const driver = Object.assign(new Error(message), { code, detail: 'private driver detail' })
    const wrapped = new Error('private SQL and bound data', { cause: driver })
    expect(getPostgresCancellationReason(wrapped)).toBe(reason)
    expect(getPostgresCancellationReason({ cause: { code, message } })).toBe(reason)
  })

  it('does not infer a timeout from SQLSTATE alone or expose arbitrary messages', () => {
    expect(
      getPostgresCancellationReason({ code: '57014', message: 'private-value' })
    ).toBeUndefined()
    expect(
      getPostgresCancellationReason({
        code: '23505',
        message: 'canceling statement due to statement timeout',
      })
    ).toBeUndefined()
    expect(
      getPostgresCancellationReason({
        code: '57014',
        message: 'canceling statement due to statement timeout: private-value',
      })
    ).toBeUndefined()
  })

  it('bounds cyclic and deeply nested causes', () => {
    const cycle = new Error('cycle')
    cycle.cause = cycle
    expect(getPostgresCancellationReason(cycle)).toBeUndefined()
    let deep = Object.assign(new Error('canceling statement due to statement timeout'), {
      code: '57014',
    }) as Error
    for (let i = 0; i < 11; i++) deep = new Error('wrapper', { cause: deep })
    expect(getPostgresCancellationReason(deep)).toBeUndefined()
  })

  it('does not attribute a later cancellation to a different outer driver code', () => {
    const error = {
      code: '23505',
      message: 'private value',
      cause: { code: '57014', message: 'canceling statement due to statement timeout' },
    }
    expect(getPostgresErrorCode(error)).toBe('23505')
    expect(getPostgresCancellationReason(error)).toBeUndefined()
  })
})

/** The driver error postgres.js throws, wrapped the way Drizzle wraps a failed query. */
function failedQuery(code: string, message = 'private driver detail'): Error {
  const driver = Object.assign(new Error(message), { code })
  return Object.assign(new Error('Failed query: private SQL\nparams: private'), {
    query: 'private SQL',
    params: ['private'],
    cause: driver,
  })
}

describe('classifyDatabaseFailure', () => {
  it.each([
    ['57014', 'canceling statement due to statement timeout', 'capacity'],
    ['55P03', 'canceling statement due to lock timeout', 'capacity'],
    ['25P03', 'terminating connection due to idle-in-transaction timeout', 'capacity'],
    ['25P04', 'terminating connection due to transaction timeout', 'capacity'],
    ['53300', 'sorry, too many clients already', 'capacity'],
    ['40P01', 'deadlock detected', 'conflict'],
    ['40001', 'could not serialize access due to concurrent update', 'conflict'],
    ['08000', 'connection exception', 'connection'],
    ['08006', 'connection failure', 'connection'],
    ['08P01', 'protocol violation', 'connection'],
    ['57P01', 'terminating connection due to administrator command', 'connection'],
    ['57P03', 'the database system is starting up', 'connection'],
    ['CONNECTION_CLOSED', 'write CONNECTION_CLOSED', 'connection'],
    ['CONNECTION_DESTROYED', 'write CONNECTION_DESTROYED', 'connection'],
    ['CONNECTION_ENDED', 'write CONNECTION_ENDED', 'connection'],
    ['CONNECT_TIMEOUT', 'write CONNECT_TIMEOUT', 'connection'],
    ['ECONNRESET', 'read ECONNRESET', 'connection'],
    ['EPIPE', 'write EPIPE', 'connection'],
    ['ETIMEDOUT', 'connect ETIMEDOUT', 'connection'],
    ['ECONNREFUSED', 'connect ECONNREFUSED', 'connection'],
    ['EHOSTUNREACH', 'connect EHOSTUNREACH', 'connection'],
    ['ENOTFOUND', 'getaddrinfo ENOTFOUND', 'connection'],
    ['EAI_AGAIN', 'getaddrinfo EAI_AGAIN', 'connection'],
    ['ENETDOWN', 'connect ENETDOWN', 'connection'],
    ['ENETRESET', 'read ENETRESET', 'connection'],
    ['ENETUNREACH', 'connect ENETUNREACH', 'connection'],
  ])('classifies %s through a query wrapper', (code, message, expected) => {
    const wrapped = failedQuery(code, message)
    expect(classifyDatabaseFailure(wrapped)).toBe(expected)
    expect(classifyDatabaseFailure(new Error('task wrapper', { cause: wrapped }))).toBe(expected)
    expect(getTransientDatabaseFailure(wrapped)).toBe(expected)
  })

  it('treats an explicit cancellation as permanent although it shares the timeout SQLSTATE', () => {
    const cancelled = failedQuery('57014', 'canceling statement due to user request')
    expect(classifyDatabaseFailure(cancelled)).toBe('permanent')
    expect(getTransientDatabaseFailure(cancelled)).toBeUndefined()
  })

  it('does not read a timeout into a 57014 with an unrecognized message', () => {
    expect(classifyDatabaseFailure(failedQuery('57014', 'private-value'))).toBe('permanent')
  })

  it.each(['23505', '42P01', '22P02', 'XX000'])('treats %s as permanent', (code) => {
    expect(classifyDatabaseFailure(failedQuery(code))).toBe('permanent')
  })

  it.each([
    'ECONNRESET',
    'EPIPE',
    'ETIMEDOUT',
    'ECONNREFUSED',
    'EHOSTUNREACH',
    'ENOTFOUND',
    'EAI_AGAIN',
    'ENETDOWN',
    'ENETRESET',
    'ENETUNREACH',
  ])('treats %s with no database query in its chain as permanent', (code) => {
    const download = Object.assign(new Error(`socket ${code}`), { code })
    expect(classifyDatabaseFailure(download)).toBe('permanent')
    expect(classifyDatabaseFailure(new Error('fetch failed', { cause: download }))).toBe(
      'permanent'
    )
  })

  /** The properties postgres.js defines on an error for a query in flight, non-enumerable. */
  function withDriverQuery(error: Error): Error {
    return Object.defineProperties(error, {
      query: { value: 'private SQL', enumerable: false },
      parameters: { value: ['private'], enumerable: false },
      args: { value: ['private'], enumerable: false },
      types: { value: undefined, enumerable: false },
    })
  }

  it('counts a socket error the driver raised with its query attached', () => {
    const driver = withDriverQuery(
      Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })
    )
    expect(classifyDatabaseFailure(driver)).toBe('connection')
  })

  it.each([
    [
      'a GraphQL client error with its query and variables',
      { query: 'query Items { items { id } }', variables: { first: 50 } },
    ],
    ['a query string beside a params array', { query: 'items', params: ['page'] }],
    ['a query string beside a parameters array', { query: 'items', parameters: ['page'] }],
  ])('treats a socket error under %s as permanent', (_label, fields) => {
    const reset = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })
    const client = Object.assign(new Error('Request failed'), { ...fields, cause: reset })
    expect(classifyDatabaseFailure(client)).toBe('permanent')
    expect(getTransientDatabaseFailure(client)).toBeUndefined()
  })

  /** A connection error as postgres.js builds one (`Errors.connection` in its source). */
  function driverConnectionError(code: string): Error {
    return Object.assign(new Error(`write ${code} localhost:5432`), {
      code,
      errno: code,
      address: 'localhost',
      port: 5432,
    })
  }

  it.each(['CONNECTION_CLOSED', 'CONNECTION_DESTROYED', 'CONNECTION_ENDED', 'CONNECT_TIMEOUT'])(
    'reads a bare driver-built %s as a connection failure, as a lost transaction raises it',
    (code) => {
      expect(classifyDatabaseFailure(driverConnectionError(code))).toBe('connection')
    }
  )

  it.each([
    ['only the code', (code: string) => Object.assign(new Error('socket closed'), { code })],
    [
      'a different message',
      (code: string) => Object.assign(driverConnectionError(code), { message: 'socket closed' }),
    ],
    [
      'no errno',
      (code: string) =>
        Object.assign(new Error(`write ${code} localhost:5432`), { code, address: 'localhost' }),
    ],
    [
      'no address',
      (code: string) =>
        Object.assign(new Error(`write ${code} localhost:5432`), { code, errno: code }),
    ],
  ])('does not read a CONNECTION_CLOSED error with %s as a database failure', (_label, build) => {
    const foreign = build('CONNECTION_CLOSED')
    expect(classifyDatabaseFailure(foreign)).toBe('permanent')
    expect(classifyDatabaseFailure(new Error('provider request failed', { cause: foreign }))).toBe(
      'permanent'
    )
  })

  it('reads a foreign CONNECTION_CLOSED under a database query error as a connection failure', () => {
    const foreign = Object.assign(new Error('socket closed'), { code: 'CONNECTION_CLOSED' })
    const wrapped = Object.assign(new Error('Failed query: private SQL\nparams: '), {
      query: 'private SQL',
      params: [],
      cause: foreign,
    })
    expect(classifyDatabaseFailure(wrapped)).toBe('connection')
  })

  it('reads a refused connection the driver took a query for, before it built the query', () => {
    const refused = Object.defineProperties(
      Object.assign(new AggregateError([], ''), { code: 'ECONNREFUSED' }),
      {
        query: { value: undefined, enumerable: false },
        parameters: { value: undefined, enumerable: false },
        args: { value: [], enumerable: false },
        types: { value: undefined, enumerable: false },
      }
    )
    expect(classifyDatabaseFailure(refused)).toBe('connection')
  })

  it('treats failures without a code as permanent', () => {
    expect(classifyDatabaseFailure(new Error('boom'))).toBe('permanent')
    expect(classifyDatabaseFailure('boom')).toBe('permanent')
    expect(classifyDatabaseFailure(undefined)).toBe('permanent')
  })

  it('classifies by the first code in the chain', () => {
    const outer = Object.assign(new Error('unique'), {
      code: '23505',
      cause: failedQuery('40P01', 'deadlock detected'),
    })
    expect(classifyDatabaseFailure(outer)).toBe('permanent')
  })
})

describe('toError', () => {
  it('returns the same Error when given an Error', () => {
    const err = new Error('test')
    expect(toError(err)).toBe(err)
  })

  it('wraps a string into an Error', () => {
    const err = toError('msg')
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe('msg')
  })

  it('wraps a number into an Error', () => {
    const err = toError(42)
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe('42')
  })

  it('wraps null into an Error', () => {
    const err = toError(null)
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe('null')
  })

  it('wraps undefined into an Error', () => {
    const err = toError(undefined)
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe('undefined')
  })
})

describe('getPostgresErrorCode', () => {
  it('reads code from Error.code', () => {
    const err = new Error('fail') as Error & { code: string }
    err.code = '23505'
    expect(getPostgresErrorCode(err)).toBe('23505')
  })

  it('reads code from plain object', () => {
    expect(getPostgresErrorCode({ code: '23505' })).toBe('23505')
  })

  it('reads code from Error.cause', () => {
    const err = new Error('fail', { cause: { code: '23505' } })
    expect(getPostgresErrorCode(err)).toBe('23505')
  })

  it('walks nested Error causes', () => {
    const pgErr = new Error('unique_violation') as Error & { code: string }
    pgErr.code = '23505'
    const err = new Error('outer', { cause: new Error('inner', { cause: pgErr }) })
    expect(getPostgresErrorCode(err)).toBe('23505')
  })

  it('returns undefined for non-errors', () => {
    expect(getPostgresErrorCode(undefined)).toBeUndefined()
    expect(getPostgresErrorCode(null)).toBeUndefined()
    expect(getPostgresErrorCode('23505')).toBeUndefined()
  })

  it('returns undefined when no code is present', () => {
    expect(getPostgresErrorCode(new Error('no code'))).toBeUndefined()
  })

  it('does not loop forever on circular cause chains', () => {
    const err1 = new Error('a')
    const err2 = new Error('b', { cause: err1 })
    // Create circular reference
    ;(err1 as { cause?: unknown }).cause = err2
    expect(getPostgresErrorCode(err1)).toBeUndefined()
  })
})

describe('describeError', () => {
  it('reports name and message for a plain error, omitting causeChain', () => {
    const described = describeError(new Error('boom'))
    expect(described).toEqual({ name: 'Error', message: 'boom' })
    expect(described.causeChain).toBeUndefined()
  })

  it('surfaces the deepest cause for a wrapped driver error', () => {
    const driver = Object.assign(new Error('read ECONNRESET'), {
      code: 'ECONNRESET',
      errno: 'ECONNRESET',
      syscall: 'read',
    })
    const wrapped = new Error('Failed query: select ...', { cause: driver })
    const described = describeError(wrapped)
    expect(described.message).toBe('read ECONNRESET')
    expect(described.code).toBe('ECONNRESET')
    expect(described.errno).toBe('ECONNRESET')
    expect(described.syscall).toBe('read')
    expect(described.causeChain).toEqual([
      'Error: Failed query: select ...',
      'Error: read ECONNRESET',
    ])
  })

  it('redacts driver-appended bound parameter values from every reported message', () => {
    const driver = Object.assign(
      new Error('cannot execute SELECT FOR UPDATE in a read-only transaction'),
      {
        code: '25006',
      }
    )
    const wrapped = new Error(
      'Failed query: select "storage_used_bytes" from "workspace" where id = $1 limit $2 for update\nparams: ws-secret-id,1',
      { cause: driver }
    )
    const described = describeError(wrapped)
    expect(described.code).toBe('25006')
    expect(described.causeChain?.[0]).toBe(
      'Error: Failed query: select "storage_used_bytes" from "workspace" where id = $1 limit $2 for update\nparams: [redacted]'
    )
    expect(JSON.stringify(described)).not.toContain('ws-secret-id')
  })

  it('redacts bound parameter values from an unwrapped driver error message', () => {
    const described = describeError(new Error('Failed query: select 1\nparams: ws-secret-id'))
    expect(described.message).toBe('Failed query: select 1\nparams: [redacted]')
  })

  it('always returns the cause for unclassified errors (AbortError)', () => {
    const aborted = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
    expect(describeError(aborted)).toEqual({
      name: 'AbortError',
      message: 'The operation was aborted',
    })
  })

  it('falls back to a populated description for non-Error input without throwing', () => {
    expect(describeError('just a string')).toEqual({ name: 'Error', message: 'just a string' })
    expect(() => describeError({ weird: true })).not.toThrow()
  })

  it('stops at depth 10 and does not loop on a cyclic cause', () => {
    const a = new Error('a')
    const b = new Error('b')
    ;(a as { cause?: unknown }).cause = b
    ;(b as { cause?: unknown }).cause = a
    let described: ReturnType<typeof describeError> | undefined
    expect(() => {
      described = describeError(a)
    }).not.toThrow()
    expect(described?.causeChain?.length).toBeLessThanOrEqual(10)
  })
})

describe('findCause', () => {
  class Marker extends Error {}
  const isMarker = (value: unknown): value is Marker => value instanceof Marker

  it('returns the error itself when it matches', () => {
    const marker = new Marker('hit')
    expect(findCause(marker, isMarker)).toBe(marker)
  })

  it('finds a match further down the cause chain', () => {
    const marker = new Marker('deep')
    const wrapped = new Error('outer', { cause: new Error('middle', { cause: marker }) })
    expect(findCause(wrapped, isMarker)).toBe(marker)
  })

  it('returns undefined when nothing matches', () => {
    expect(findCause(new Error('plain'), isMarker)).toBeUndefined()
  })

  it('survives a cyclic chain', () => {
    const a = new Error('a')
    const b = new Error('b')
    Object.assign(a, { cause: b })
    Object.assign(b, { cause: a })
    expect(findCause(a, isMarker)).toBeUndefined()
  })
})

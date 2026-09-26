import {
  classifyDatabaseFailure,
  describeError,
  getPostgresCancellationReason,
  getPostgresErrorCode,
  getTransientDatabaseFailure,
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

  /** The properties postgres.js defines on an error for a query in flight, non-enumerable. */
  function _withDriverQuery(error: Error): Error {
    return Object.defineProperties(error, {
      query: { value: 'private SQL', enumerable: false },
      parameters: { value: ['private'], enumerable: false },
      args: { value: ['private'], enumerable: false },
      types: { value: undefined, enumerable: false },
    })
  }

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
})

describe('describeError', () => {
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

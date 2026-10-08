/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  ORACLE_WORKER_PROTOCOL_VERSION,
  parseOracleWorkerResponse,
  serializeOracleWorkerRequest,
} from '@/lib/internal/oracledb/worker-protocol'

const CONNECTION = {
  host: 'db.example.com',
  port: 1521,
  protocol: 'tcp',
  connectionType: 'serviceName',
  serviceName: 'FREEPDB1',
  username: 'application',
  password: 'secret',
  connectionTimeout: 15000,
  proxyHost: '127.0.0.1',
  proxyPort: 32000,
} as const

describe('Oracle worker protocol', () => {
  it('serializes one bounded semantic request', () => {
    expect(
      JSON.parse(
        serializeOracleWorkerRequest({
          protocolVersion: ORACLE_WORKER_PROTOCOL_VERSION,
          type: 'execute',
          connection: CONNECTION,
          statements: [{ sql: 'SELECT 1 FROM DUAL', maxRows: 1 }],
          readOnlyTransaction: true,
        })
      )
    ).toMatchObject({ type: 'execute', readOnlyTransaction: true })
  })

  it('rejects empty batches and invalid response rows', () => {
    expect(() =>
      serializeOracleWorkerRequest({
        protocolVersion: ORACLE_WORKER_PROTOCOL_VERSION,
        type: 'execute',
        connection: CONNECTION,
        statements: [],
        readOnlyTransaction: false,
      })
    ).toThrow('1-8 statements')
    expect(() =>
      parseOracleWorkerResponse({
        protocolVersion: 1,
        ok: true,
        results: [{ rows: [42], rowCount: 1 }],
      })
    ).toThrow('non-object row')
  })

  it('preserves the worker error envelope without accepting another protocol version', () => {
    expect(
      parseOracleWorkerResponse({
        protocolVersion: 1,
        ok: false,
        error: { message: 'connection failed' },
      })
    ).toEqual({
      protocolVersion: 1,
      ok: false,
      error: { message: 'connection failed' },
    })
    expect(() => parseOracleWorkerResponse({ protocolVersion: 2, ok: true, results: [] })).toThrow(
      'unsupported protocol'
    )
  })
})

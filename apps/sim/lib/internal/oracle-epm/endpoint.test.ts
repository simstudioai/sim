/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import {
  getOracleEpmEndpoint,
  oracleEpmLiteral,
  oracleEpmPathParameter,
  oracleEpmQuery,
} from '@/lib/internal/oracle-epm/endpoint'
import { defineOracleEpmRouteSpace } from '@/lib/internal/oracle-epm/route-space'
import type { OracleEpmEndpoint } from '@/lib/internal/oracle-epm/types'

const routes = defineOracleEpmRouteSpace({
  context: ['Synthetic', 'rest'],
  allowedVersions: ['v3', 'V1'],
})

describe('Oracle EPM endpoints', () => {
  it('freezes the complete static contract', () => {
    const endpoint = routes.defineEndpoint({
      method: 'GET',
      version: 'V1',
      path: [oracleEpmLiteral('jobs'), oracleEpmPathParameter('jobId', { maxBytes: 64 })],
      query: { limit: oracleEpmQuery.integer({ minimum: 1, maximum: 100 }) },
      headers: { etag: { name: 'If-None-Match', maxBytes: 128 } },
      body: 'none',
      response: 'json',
      timeoutMs: 5_000,
      maxResponseBytes: 1_024,
    })
    const declaration = getOracleEpmEndpoint(endpoint)
    expect(declaration.version).toBe('V1')
    expect(Object.isFrozen(endpoint)).toBe(true)
    expect(Object.isFrozen(declaration.path)).toBe(true)
    expect(Object.isFrozen(declaration.query)).toBe(true)
  })

  it('rejects versions with the wrong case and dangerous headers', () => {
    expect(() =>
      routes.defineEndpoint({
        method: 'GET',
        version: 'v1',
        path: [],
        body: 'none',
        response: 'json',
        timeoutMs: 1_000,
        maxResponseBytes: 100,
      })
    ).toThrow('version')
    expect(() =>
      routes.defineEndpoint({
        method: 'GET',
        version: 'v3',
        path: [],
        headers: { raw: { name: 'Authorization', maxBytes: 10 } },
        body: 'none',
        response: 'json',
        timeoutMs: 1_000,
        maxResponseBytes: 100,
      })
    ).toThrow('header')
  })

  it('requires bounded request bodies and safe retry policies', () => {
    expect(() =>
      routes.defineEndpoint({
        method: 'POST',
        version: 'v3',
        path: [],
        body: 'json',
        response: 'json',
        timeoutMs: 1_000,
        maxResponseBytes: 100,
      })
    ).toThrow('request limit')
    expect(() =>
      routes.defineEndpoint({
        method: 'POST',
        version: 'v3',
        path: [],
        body: 'json',
        maxRequestBytes: 100,
        response: 'json',
        timeoutMs: 1_000,
        maxResponseBytes: 100,
        retry: { maxAttempts: 2, statuses: [503], initialDelayMs: 1, maxDelayMs: 2 },
      })
    ).toThrow('retry policy')
  })

  it('rejects forged endpoints', () => {
    expect(() => getOracleEpmEndpoint({} as OracleEpmEndpoint)).toThrow('not a valid declaration')
  })
})

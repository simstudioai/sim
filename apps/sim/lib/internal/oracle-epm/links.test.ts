/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { oracleEpmLiteral } from '@/lib/internal/oracle-epm/endpoint'
import { getOracleEpmReturnedLinkPolicy } from '@/lib/internal/oracle-epm/links'
import { defineOracleEpmRouteSpace } from '@/lib/internal/oracle-epm/route-space'
import type { OracleEpmReturnedLinkPolicy } from '@/lib/internal/oracle-epm/types'

const routes = defineOracleEpmRouteSpace({
  context: ['Synthetic', 'rest'],
  allowedVersions: ['v3'],
})

describe('Oracle EPM returned-link declarations', () => {
  it('binds a frozen policy to an endpoint', () => {
    const endpoint = routes.defineEndpoint({
      method: 'GET',
      version: 'v3',
      path: [oracleEpmLiteral('download')],
      body: 'none',
      response: 'stream',
      timeoutMs: 2_000,
      maxResponseBytes: 1_024,
    })
    const policy = routes.defineReturnedLinkPolicy({
      relation: 'download',
      method: 'GET',
      endpoint,
      preserveGatewayBasePath: true,
    })
    expect(Object.isFrozen(policy)).toBe(true)
    expect(getOracleEpmReturnedLinkPolicy(policy)).toMatchObject({
      relation: 'download',
      method: 'GET',
      version: 'v3',
    })
  })

  it('rejects method overrides and forged policies', () => {
    const endpoint = routes.defineEndpoint({
      method: 'GET',
      version: 'v3',
      path: [],
      body: 'none',
      response: 'empty',
      timeoutMs: 1_000,
      maxResponseBytes: 1,
    })
    expect(() =>
      routes.defineReturnedLinkPolicy({
        relation: 'next',
        method: 'POST',
        endpoint,
        preserveGatewayBasePath: true,
      })
    ).toThrow('match')
    expect(() => getOracleEpmReturnedLinkPolicy({} as OracleEpmReturnedLinkPolicy)).toThrow(
      'not a valid declaration'
    )
  })
})

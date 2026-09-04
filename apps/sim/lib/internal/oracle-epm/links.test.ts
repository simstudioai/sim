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
  describe.each(['endpoint', 'route'] as const)('%s-bound policies', (binding) => {
    const declaration = {
      method: 'GET',
      version: 'v3',
      path: [oracleEpmLiteral('download')],
      body: 'none',
      response: 'stream',
      timeoutMs: 2_000,
      maxResponseBytes: 1_024,
    } as const
    const endpoint = routes.defineEndpoint(declaration)

    function definePolicy(relation: string) {
      return routes.defineReturnedLinkPolicy({
        relation,
        method: 'GET',
        ...(binding === 'endpoint'
          ? { endpoint }
          : {
              version: declaration.version,
              path: declaration.path,
              response: declaration.response,
              timeoutMs: declaration.timeoutMs,
              maxResponseBytes: declaration.maxResponseBytes,
            }),
        preserveGatewayBasePath: true,
      })
    }

    it.each([
      'a',
      'download',
      'report-content.v1_2',
      'Job Status',
      'Download link',
      'Report Job Status',
      'Job 1.v2_3-4',
      'a'.repeat(64),
      `Job ${'a'.repeat(60)}`,
    ])('preserves relation %j in a frozen policy', (relation) => {
      const policy = definePolicy(relation)
      const definition = getOracleEpmReturnedLinkPolicy(policy)
      expect(Object.isFrozen(policy)).toBe(true)
      expect(Object.isFrozen(definition)).toBe(true)
      expect(definition).toMatchObject({ relation, method: 'GET', version: 'v3' })
    })

    it.each([
      '',
      'a'.repeat(65),
      `Job ${'a'.repeat(61)}`,
      '1Job',
      '.Job',
      '_Job',
      '-Job',
      ' Job Status',
      'Job Status ',
      'Job  Status',
      'Job\tStatus',
      'Job\nStatus',
      'Job\rStatus',
      'download\n',
      'download\r',
      'Job Status\n',
      'Job Status\r\n',
      'Job\u0000Status',
      'Job\u001fStatus',
      'Job\u007fStatus',
      'Job\u00a0Status',
      'Job\u200bStatus',
      'Job Status\u2028',
      'Job Status\u2029',
      'Job/Status',
      'Job\\Status',
      'Job:Status',
      'Job%20Status',
      'Jób Status',
      'Job 😀',
      'Job\uD800',
    ])('rejects invalid relation %j', (relation) => {
      expect(() => definePolicy(relation)).toThrow('Oracle EPM returned-link relation is invalid')
    })

    it.each(
      [undefined, null, 1, true, {}, ['Job Status'], { toString: () => 'Job Status' }].map(
        (relation) => ({ relation })
      )
    )('rejects non-string relation $relation without coercion', ({ relation }) => {
      expect(() => definePolicy(relation as unknown as string)).toThrow(
        'Oracle EPM returned-link relation is invalid'
      )
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

  it('rejects endpoint-bound policies whose required headers cannot be supplied', () => {
    const endpoint = routes.defineEndpoint({
      method: 'GET',
      version: 'v3',
      path: [oracleEpmLiteral('download')],
      headers: { range: { name: 'Range', required: true, maxBytes: 64 } },
      body: 'none',
      response: 'stream',
      timeoutMs: 2_000,
      maxResponseBytes: 1_024,
    })

    expect(() =>
      routes.defineReturnedLinkPolicy({
        relation: 'download',
        method: 'GET',
        endpoint,
        preserveGatewayBasePath: true,
      })
    ).toThrow('input contract')
  })
})

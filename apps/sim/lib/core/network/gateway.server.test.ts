import { getCACertificates, setDefaultCACertificates } from 'node:tls'
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts'
import { resolveHostAddresses } from '@sim/security/dns'
import { networkConfigMock, networkConfigMockFns } from '@sim/testing/mocks/network-config.mock'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { OutboundGateway, ResolvedOutboundRoute } from '@/lib/core/network/config.server'

vi.mock('@/lib/core/network/config.server', () => networkConfigMock)
/** The synthetic origin's name resolves to the one address the local gateway admits. */
vi.mock('@sim/security/dns', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@sim/security/dns')>()),
  resolveHostAddresses: vi.fn(async () => ({ addresses: ['1.1.1.1'], preferred: '1.1.1.1' })),
}))

import { runWithOutboundOrganization } from '@/lib/core/network/context.server'
import { openGatewayTunnel, secureOutboundTunnel } from '@/lib/core/network/gateway.server'
import {
  type GatewayTlsFixture,
  startGatewayTlsFixture,
} from '@/lib/core/network/gateway-tls.test-helpers'
import { organizationAwsRequestHandler } from '@/lib/core/network/organization-aws-handler.server'
import { outboundFetch } from '@/lib/core/network/outbound-fetch.server'
import { isUnavailableFailure } from '@/lib/core/orchestration/types'
import {
  createPinnedFetchWithDispatcher,
  secureFetchWithPinnedIP,
} from '@/lib/core/security/input-validation.server'
import { isHostNotFound } from '@/lib/credentials/token-service-accounts/errors'

const state = { gateways: new Map<string, OutboundGateway>() }

networkConfigMockFns.mockIsOutboundRoutingEnabled.mockReturnValue(true)
networkConfigMockFns.mockResolveOutboundRoute.mockImplementation(
  async (organizationId: string | null | undefined): Promise<ResolvedOutboundRoute> => {
    const gateway = organizationId ? state.gateways.get(organizationId) : undefined
    if (!gateway || !organizationId) throw new Error('No configured route')
    return { kind: 'gateway', gateway }
  }
)

let fixture: GatewayTlsFixture
const trust = getCACertificates('default')
beforeAll(async () => {
  fixture = await startGatewayTlsFixture(['alpha', 'bravo'])
  setDefaultCACertificates([...trust, fixture.cert])
  for (const [id, token] of [
    ['org_a', 'alpha'],
    ['org_b', 'bravo'],
  ])
    state.gateways.set(id, {
      id,
      organizationId: id,
      token,
      url: `https://127.0.0.1:${fixture.proxyPort}`,
      servername: 'gateway.invalid',
      ca: fixture.cert,
    })
})
afterAll(async () => {
  await fixture.close()
  setDefaultCACertificates(trust)
})
const url = () => 'https://origin.invalid'
const gatewayFor = (organizationId: string): OutboundGateway => {
  const gateway = state.gateways.get(organizationId)
  if (!gateway) throw new Error(`No gateway for ${organizationId}`)
  return gateway
}
const options = { profile: 'selfHostedService' as const }

describe('organization gateways over real TLS CONNECT sockets', () => {
  it('preserves signed request targets and origin authentication through the gateway', async () => {
    const target = '/exports/../raw/audit_logs/event%2Fpart.ndjson?x-id=PutObject&token=%2B'
    const response = await runWithOutboundOrganization('org_a', () =>
      secureFetchWithPinnedIP(`${url()}${target}`, '1.1.1.1', {
        ...options,
        requestTarget: target,
        method: 'PUT',
        body: '{"id":"event"}\n',
        headers: {
          authorization: 'AWS4-HMAC-SHA256 signed-request',
          'Proxy-Authorization': 'must-not-reach-origin',
        },
      })
    )
    expect(await response.text()).toBe('{"id":"event"}\n')
    expect(response.headers.get('x-via-proxy')).toBe('yes')
    expect(fixture.origin.target).toBe(target)
    expect(fixture.origin.headers.authorization).toBe('AWS4-HMAC-SHA256 signed-request')
    expect(fixture.origin.headers['proxy-authorization']).toBeUndefined()
    expect(fixture.admissions.at(-1)?.destination).toBe('1.1.1.1:443')
  })

  it('keeps an upgraded tunnel usable after five minutes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    let tunnel: Socket | undefined
    try {
      tunnel = await secureOutboundTunnel(
        await openGatewayTunnel(state.gateways.get('org_a')!, '1.1.1.1', 443),
        'origin.invalid',
        443
      )
      await vi.advanceTimersByTimeAsync(6 * 60_000)
      expect(tunnel.destroyed).toBe(false)
      tunnel.write('GET /done HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n')
      const chunks: Buffer[] = []
      for await (const chunk of tunnel) chunks.push(Buffer.from(chunk))
      expect(Buffer.concat(chunks).toString()).toContain('reached')
    } finally {
      tunnel?.destroy()
      vi.useRealTimers()
    }
  })

  it('pins guarded requests and keeps proxy credentials out of origin headers', async () => {
    const response = await runWithOutboundOrganization('org_a', () =>
      secureFetchWithPinnedIP(url(), '1.1.1.1', {
        ...options,
        headers: { 'Proxy-Authorization': 'must-not-reach-origin' },
      })
    )
    expect(await response.text()).toBe('tls reached')
    expect(fixture.admissions.at(-1)).toEqual({
      token: 'Bearer alpha',
      destination: '1.1.1.1:443',
      sni: 'gateway.invalid',
    })
    expect(fixture.origin.headers['proxy-authorization']).toBeUndefined()
    expect(fixture.origin.headers.host).toBe('origin.invalid')
  })
  it('isolates concurrent requests to the same origin and rotates pools when its gateway assignment changes', async () => {
    const transport = createPinnedFetchWithDispatcher('1.1.1.1', options)
    const start = fixture.admissions.length
    try {
      expect(
        await Promise.all(
          ['org_a', 'org_b'].map((id) =>
            runWithOutboundOrganization(id, async () => (await transport.fetch(url())).text())
          )
        )
      ).toEqual(['tls reached', 'tls reached'])
      expect(
        fixture.admissions
          .slice(start)
          .map((item) => item.token)
          .sort()
      ).toEqual(['Bearer alpha', 'Bearer bravo'])
      state.gateways.set('org_a', { ...state.gateways.get('org_a')!, id: 'gateway-next' })
      await runWithOutboundOrganization('org_a', async () => (await transport.fetch(url())).text())
      expect(fixture.admissions.length).toBe(start + 3)
    } finally {
      await transport.dispatcher.destroy()
    }
  })
  it('preserves upstream TLS identity on both transports and rejects the wrong hostname', async () => {
    const transport = createPinnedFetchWithDispatcher('1.1.1.1', options)
    try {
      await runWithOutboundOrganization('org_a', async () => {
        expect(await (await transport.fetch(url())).text()).toBe('tls reached')
        expect(await (await secureFetchWithPinnedIP(url(), '1.1.1.1', options)).text()).toBe(
          'tls reached'
        )
        await expect(transport.fetch('https://wrong.invalid')).rejects.toThrow()
        await expect(
          transport.fetch('https://wrong.invalid', {
            headers: { host: 'origin.invalid' },
          })
        ).rejects.toThrow()
        await expect(
          secureFetchWithPinnedIP('https://wrong.invalid', '1.1.1.1', options)
        ).rejects.toThrow()
      })
    } finally {
      await transport.dispatcher.destroy()
    }
  })
  it('preserves Request bodies, encodes multipart data, and honors manual redirects', async () => {
    const transport = createPinnedFetchWithDispatcher('1.1.1.1', options)
    try {
      await runWithOutboundOrganization('org_a', async () => {
        expect(
          await (
            await transport.fetch(new Request(url(), { method: 'POST', body: 'request body' }))
          ).text()
        ).toBe('request body')
        const form = new FormData()
        form.set('field', 'multipart body')
        expect(
          await (await transport.fetch(url(), { method: 'POST', body: form })).text()
        ).toContain('multipart body')
        const redirect = await transport.fetch(`${url()}/redirect`, { redirect: 'manual' })
        expect(redirect.status).toBe(302)
        await redirect.body?.cancel()
      })
    } finally {
      await transport.dispatcher.destroy()
    }
  })
  it('fails an unresolvable destination as a missing host, not as an unavailable gateway', async () => {
    vi.mocked(resolveHostAddresses).mockRejectedValueOnce(
      Object.assign(new Error('getaddrinfo ENOTFOUND missing.invalid'), { code: 'ENOTFOUND' })
    )
    const start = fixture.admissions.length
    const failure = await runWithOutboundOrganization('org_a', () =>
      outboundFetch('https://missing.invalid', { redirect: 'error' })
    ).catch((error: unknown) => error)
    expect(isHostNotFound(failure)).toBe(true)
    expect(isUnavailableFailure(failure)).toBe(false)
    expect(fixture.admissions.length).toBe(start)
  })
  it("sends outboundFetch through the scoped organization's gateway", async () => {
    const start = fixture.admissions.length
    await runWithOutboundOrganization('org_b', async () => {
      const response = await outboundFetch(url(), {
        method: 'POST',
        body: 'grant_type=client_credentials',
        redirect: 'error',
      })
      expect(response.headers.get('x-via-proxy')).toBe('yes')
      await response.body?.cancel()
    })
    expect(fixture.admissions.slice(start)).toEqual([
      { token: 'Bearer bravo', destination: '1.1.1.1:443', sni: 'gateway.invalid' },
    ])
  })
  describe('AWS SDK clients signing with customer credentials', () => {
    const sts = new STSClient({
      region: 'us-east-1',
      endpoint: url(),
      maxAttempts: 1,
      credentials: { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret' },
      requestHandler: organizationAwsRequestHandler(),
    })
    afterAll(() => sts.destroy())

    /** The origin echoes the signed query body, which STS cannot parse; only the route matters. */
    const viaProxy = async (organizationId: string) => {
      const error = await runWithOutboundOrganization(organizationId, () =>
        sts.send(new GetCallerIdentityCommand({}))
      ).then(
        () => undefined,
        (failure: { $response?: { headers: Record<string, string> } }) => failure
      )
      return error?.$response?.headers['x-via-proxy']
    }

    it('tunnels each organization with its own credential and never shares its pooled socket', async () => {
      const start = fixture.admissions.length
      expect(await viaProxy('org_a')).toBe('yes')
      expect(await viaProxy('org_b')).toBe('yes')
      expect(await viaProxy('org_a')).toBe('yes')
      expect(await viaProxy('org_b')).toBe('yes')
      expect(fixture.admissions.slice(start)).toEqual([
        { token: 'Bearer alpha', destination: '1.1.1.1:443', sni: 'gateway.invalid' },
        { token: 'Bearer bravo', destination: '1.1.1.1:443', sni: 'gateway.invalid' },
      ])
    })
  })

  it('fails closed on denied proxy credentials without contacting the origin', async () => {
    state.gateways.set('denied', {
      ...state.gateways.get('org_a')!,
      organizationId: 'denied',
      token: 'denied',
    })
    const transport = createPinnedFetchWithDispatcher('1.1.1.1', options)
    const start = fixture.origin.requests
    try {
      await runWithOutboundOrganization('denied', async () => {
        await expect(transport.fetch(url())).rejects.toThrow()
        await expect(secureFetchWithPinnedIP(url(), '1.1.1.1', options)).rejects.toThrow()
      })
      expect(fixture.origin.requests).toBe(start)
    } finally {
      await transport.dispatcher.destroy()
    }
  })
  it('supports cancellation without a direct retry', async () => {
    const transport = createPinnedFetchWithDispatcher('1.1.1.1', options)
    const controller = new AbortController()
    try {
      const promise = runWithOutboundOrganization('org_a', () =>
        transport.fetch(`${url()}/wait`, { signal: controller.signal })
      )
      controller.abort()
      await expect(promise).rejects.toThrow()
    } finally {
      await transport.dispatcher.destroy()
    }
  })

  it.each(['reset', 503] as const)(
    'retries a CONNECT that fails with %s before the tunnel opens and completes the request',
    async (failure) => {
      fixture.connectFailures.push(failure)
      const start = fixture.admissions.length
      try {
        const response = await runWithOutboundOrganization('org_a', () =>
          secureFetchWithPinnedIP(url(), '1.1.1.1', options)
        )
        expect(await response.text()).toBe('tls reached')
        expect(fixture.admissions.length).toBe(start + 2)
      } finally {
        fixture.connectFailures.length = 0
      }
    }
  )

  it('does not retry a rejected proxy credential', async () => {
    const start = fixture.admissions.length
    await expect(
      openGatewayTunnel({ ...gatewayFor('org_a'), token: 'denied' }, '1.1.1.1', 443)
    ).rejects.toMatchObject({ code: 'GATEWAY_UNAVAILABLE' })
    expect(fixture.admissions.length).toBe(start + 1)
  })

  it('gives up after two failed CONNECT attempts', async () => {
    fixture.connectFailures.push('reset', 503)
    const start = fixture.admissions.length
    try {
      await expect(openGatewayTunnel(gatewayFor('org_a'), '1.1.1.1', 443)).rejects.toMatchObject({
        code: 'GATEWAY_UNAVAILABLE',
      })
      expect(fixture.admissions.length).toBe(start + 2)
    } finally {
      fixture.connectFailures.length = 0
    }
  })
})

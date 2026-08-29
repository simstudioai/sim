/**
 * @vitest-environment node
 *
 * End-to-end over a real socket: the guard resolves, classifies, pins, and
 * connects. Nothing about the transport is mocked, which is what makes this the
 * check that the policy is actually wired to the wire.
 *
 * Uses a private address on a real interface rather than a public DNS name that
 * resolves to loopback, so the suite needs no outbound DNS.
 */
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { networkInterfaces } from 'node:os'
import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { secureFetchWithValidation } from '@/lib/core/security/input-validation.server'

/** A non-loopback RFC1918 address on this machine, or null when there is none. */
function privateInterfaceAddress(): string | null {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family !== 'IPv4' || address.internal) continue
      if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address.address)) {
        return address.address
      }
    }
  }
  return null
}

const host = privateInterfaceAddress()

let server: Server
let port = 0

beforeAll(async () => {
  if (!host) return
  server = createServer((request, response) => {
    request.resume()
    response.writeHead(200, { 'content-type': 'text/plain' })
    response.end('reached')
  })
  await new Promise<void>((resolve) => server.listen(0, host, resolve))
  port = (server.address() as AddressInfo).port
})

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()))
  resetEnvFlagsMock()
})

afterEach(resetEnvFlagsMock)

// Skipped on a host with no private interface (some CI sandboxes); the policy
// itself is covered without a socket in packages/security.
describe.skipIf(!host)('reaching a service on a private network', () => {
  it('refuses an unlisted destination and names the setting that would permit it', async () => {
    // https, so the refusal comes from the address rather than the scheme.
    await expect(
      secureFetchWithValidation(`https://${host}:${port}/`, { profile: 'requestTarget' })
    ).rejects.toThrow(/private or reserved address.*EGRESS_ALLOWED_HOSTS/s)
  })

  it('reaches it over plain HTTP once the operator names the range', async () => {
    setEnvFlags({ egressAllowedIpRanges: `${host}/32` })

    const response = await secureFetchWithValidation(`http://${host}:${port}/`, {
      profile: 'requestTarget',
    })

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('reached')
  })

  it('does not extend that reach to a content-provenance URL', async () => {
    setEnvFlags({ egressAllowedIpRanges: `${host}/32` })

    // https, so the refusal has to come from the address rather than the scheme —
    // otherwise this passes even if contentFetch started honouring the allowlist.
    await expect(
      secureFetchWithValidation(`https://${host}:${port}/`, { profile: 'contentFetch' })
    ).rejects.toThrow(/private or reserved address/)
  })
})

// Needs no private interface, so it runs everywhere the suite above may not.
describe('reaching a loopback service', () => {
  it('works without any allowlist, as a self-hosted deployment expects', async () => {
    const local = createServer((request, response) => {
      request.resume()
      response.end('local')
    })
    await new Promise<void>((resolve) => local.listen(0, '127.0.0.1', resolve))
    const localPort = (local.address() as AddressInfo).port
    try {
      const response = await secureFetchWithValidation(`http://localhost:${localPort}/`, {
        profile: 'selfHostedService',
      })
      expect(await response.text()).toBe('local')
    } finally {
      await new Promise<void>((resolve) => local.close(() => resolve()))
    }
  })

  it('does not extend that to a content-provenance URL', async () => {
    await expect(
      secureFetchWithValidation('https://localhost:1/', { profile: 'contentFetch' })
    ).rejects.toThrow(/loopback/)
  })
})

/**
 * @vitest-environment node
 */
import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDnsLookup } = vi.hoisted(() => ({
  mockDnsLookup: vi.fn(),
}))

vi.mock('dns/promises', () => ({
  default: { lookup: mockDnsLookup },
}))

import { validateConnectServerUrl } from '@/app/api/tools/onepassword/utils'

afterAll(resetEnvFlagsMock)

describe('validateConnectServerUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setEnvFlags({ isHosted: false })
  })

  it('rejects a non-URL string', async () => {
    await expect(validateConnectServerUrl('not a url')).rejects.toThrow('is not a valid URL')
  })

  describe('hosted deployment', () => {
    beforeEach(() => {
      setEnvFlags({ isHosted: true })
    })

    it.each([
      ['loopback', 'http://127.0.0.1:8080'],
      ['RFC1918 10.x', 'http://10.0.0.5'],
      ['RFC1918 192.168.x', 'http://192.168.1.1:8443'],
      ['RFC1918 172.16.x', 'http://172.16.0.9'],
      ['link-local metadata', 'http://169.254.169.254'],
      ['IPv4-mapped IPv6 private', 'http://[::ffff:10.0.0.1]'],
      ['IPv6 loopback', 'http://[::1]'],
    ])('blocks %s', async (_label, url) => {
      await expect(validateConnectServerUrl(url)).rejects.toThrow(
        'cannot point to a private or reserved IP address'
      )
    })

    it('allows a public IP literal', async () => {
      await expect(validateConnectServerUrl('https://8.8.8.8')).resolves.toBe('8.8.8.8')
    })

    it('blocks a hostname that resolves to a private IP', async () => {
      mockDnsLookup.mockResolvedValue([{ address: '10.1.2.3', family: 4 }])
      await expect(validateConnectServerUrl('https://connect.internal')).rejects.toThrow(
        'cannot point to a private or reserved IP address'
      )
    })

    it('allows a hostname that resolves to a public IP', async () => {
      mockDnsLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
      await expect(validateConnectServerUrl('https://connect.example.com')).resolves.toBe(
        '93.184.216.34'
      )
    })

    it('prefers the IPv4 address for a dual-stack host (avoids unreachable IPv6 pin)', async () => {
      mockDnsLookup.mockResolvedValue([
        { address: '2606:4700::6810:85e5', family: 6 },
        { address: '93.184.216.34', family: 4 },
      ])
      await expect(validateConnectServerUrl('https://connect.example.com')).resolves.toBe(
        '93.184.216.34'
      )
    })

    it('pins the sole IPv6 address for an IPv6-only host', async () => {
      mockDnsLookup.mockResolvedValue([{ address: '2606:4700::6810:85e5', family: 6 }])
      await expect(validateConnectServerUrl('https://connect.example.com')).resolves.toBe(
        '2606:4700::6810:85e5'
      )
    })
  })

  describe('self-hosted deployment', () => {
    beforeEach(() => {
      setEnvFlags({ isHosted: false })
    })

    it.each([
      ['loopback', 'http://127.0.0.1:8080', '127.0.0.1'],
      ['RFC1918 10.x', 'http://10.0.0.5', '10.0.0.5'],
      ['RFC1918 192.168.x', 'http://192.168.1.1:8443', '192.168.1.1'],
    ])('allows %s (private Connect server)', async (_label, url, expected) => {
      await expect(validateConnectServerUrl(url)).resolves.toBe(expected)
    })

    it('still blocks link-local metadata', async () => {
      await expect(validateConnectServerUrl('http://169.254.169.254')).rejects.toThrow(
        'cannot point to a link-local address'
      )
    })

    it('still blocks IPv6 link-local', async () => {
      await expect(validateConnectServerUrl('http://[fe80::1]')).rejects.toThrow(
        'cannot point to a link-local address'
      )
    })

    it('allows a hostname that resolves to a private IP', async () => {
      mockDnsLookup.mockResolvedValue([{ address: '10.1.2.3', family: 4 }])
      await expect(validateConnectServerUrl('https://connect.internal')).resolves.toBe('10.1.2.3')
    })
  })

  it('rejects when DNS resolution fails', async () => {
    mockDnsLookup.mockRejectedValue(new Error('ENOTFOUND'))
    await expect(validateConnectServerUrl('https://nope.invalid')).rejects.toThrow(
      'could not be resolved'
    )
  })
})

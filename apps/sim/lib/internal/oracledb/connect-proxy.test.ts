/**
 * @vitest-environment node
 */

import { once } from 'node:events'
import net from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const validationMocks = vi.hoisted(() => ({
  validateDatabaseHost: vi.fn(),
}))

vi.mock('@/lib/core/security/input-validation.server', () => validationMocks)

import {
  createOracleConnectProxy,
  oracleConnectProxyInternals,
} from '@/lib/internal/oracledb/connect-proxy'

const servers = new Set<net.Server>()

async function sendRawConnect(port: number, request: string): Promise<string> {
  const client = new net.Socket()
  client.connect(port, '127.0.0.1')
  await once(client, 'connect')

  const response = new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = []
    const timeout = setTimeout(() => {
      client.destroy()
      reject(new Error('CONNECT response timed out'))
    }, 2000)
    client.on('data', (chunk: Buffer) => chunks.push(chunk))
    client.once('error', () => {
      clearTimeout(timeout)
      resolve(Buffer.concat(chunks).toString())
    })
    client.once('close', () => {
      clearTimeout(timeout)
      resolve(Buffer.concat(chunks).toString())
    })
  })

  client.write(request)
  return response
}

async function listen(server: net.Server): Promise<number> {
  servers.add(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Test server did not bind')
  return address.port
}

describe('Oracle loopback CONNECT proxy', () => {
  beforeEach(() => vi.clearAllMocks())

  afterEach(async () => {
    vi.restoreAllMocks()
    await Promise.all(
      Array.from(servers, (server) =>
        server.listening
          ? new Promise<void>((resolve) => server.close(() => resolve()))
          : Promise.resolve()
      )
    )
    servers.clear()
  })

  it('validates the requested target and dials only the pinned IP', async () => {
    const upstream = net.createServer((socket) => socket.pipe(socket))
    const upstreamPort = await listen(upstream)
    validationMocks.validateDatabaseHost.mockResolvedValue({
      isValid: true,
      resolvedIP: '127.0.0.1',
      originalHostname: 'redirect.example.com',
    })
    const proxy = await createOracleConnectProxy(5000)
    const client = net.createConnection({ host: proxy.host, port: proxy.port })
    await once(client, 'connect')
    client.write(`CONNECT redirect.example.com:${upstreamPort} HTTP/1.1\r\n\r\n`)
    const [handshake] = (await once(client, 'data')) as [Buffer]
    expect(handshake.toString()).toContain('200 Connection Established')
    client.write('oracle-net-payload')
    const [echo] = (await once(client, 'data')) as [Buffer]
    expect(echo.toString()).toBe('oracle-net-payload')
    expect(validationMocks.validateDatabaseHost).toHaveBeenCalledWith(
      'redirect.example.com',
      'Oracle Database host',
      { logDetails: false }
    )
    client.destroy()
    await proxy.close()
  })

  it('blocks a private or otherwise denied redirect before dialing it', async () => {
    validationMocks.validateDatabaseHost.mockResolvedValue({
      isValid: false,
      error: 'Oracle Database host resolves to a blocked address',
    })
    const proxy = await createOracleConnectProxy(5000)
    const client = net.createConnection({ host: proxy.host, port: proxy.port })
    await once(client, 'connect')
    client.write('CONNECT 169.254.169.254:80 HTTP/1.1\r\n\r\n')
    const [response] = (await once(client, 'data')) as [Buffer]

    expect(response.toString()).toContain('403 CONNECT Target Blocked')
    expect(proxy.getFailureReason()).toContain('blocked address')
    client.destroy()
    await proxy.close()
  })

  it('revalidates every redirect tunnel instead of trusting the first destination', async () => {
    const upstream = net.createServer((socket) => socket.pipe(socket))
    const upstreamPort = await listen(upstream)
    validationMocks.validateDatabaseHost
      .mockResolvedValueOnce({
        isValid: true,
        resolvedIP: '127.0.0.1',
        originalHostname: 'initial.example.com',
      })
      .mockResolvedValueOnce({
        isValid: false,
        error: 'Oracle Database host has mixed public and private DNS answers',
      })
    const proxy = await createOracleConnectProxy(5000)

    const initial = net.createConnection({ host: proxy.host, port: proxy.port })
    await once(initial, 'connect')
    initial.write(`CONNECT initial.example.com:${upstreamPort} HTTP/1.1\r\n\r\n`)
    const [initialResponse] = (await once(initial, 'data')) as [Buffer]
    expect(initialResponse.toString()).toContain('200 Connection Established')
    initial.destroy()
    await once(initial, 'close')

    const redirect = net.createConnection({ host: proxy.host, port: proxy.port })
    await once(redirect, 'connect')
    redirect.write(`CONNECT redirect.example.com:${upstreamPort} HTTP/1.1\r\n\r\n`)
    const [redirectResponse] = (await once(redirect, 'data')) as [Buffer]
    expect(redirectResponse.toString()).toContain('403 CONNECT Target Blocked')
    expect(validationMocks.validateDatabaseHost.mock.calls.map(([host]) => host)).toEqual([
      'initial.example.com',
      'redirect.example.com',
    ])
    redirect.destroy()
    await proxy.close()
  })

  it('parses bracketed and unbracketed IPv6 CONNECT authorities', () => {
    expect(oracleConnectProxyInternals.parseConnectTarget('[2001:db8::1]:1521')).toEqual({
      host: '2001:db8::1',
      port: 1521,
    })
    expect(oracleConnectProxyInternals.parseConnectTarget('2001:db8::1:1521')).toEqual({
      host: '2001:db8::1',
      port: 1521,
    })
  })

  it('rejects oversized or ambiguous CONNECT authorities before validation', () => {
    expect(oracleConnectProxyInternals.parseConnectTarget(`${'a'.repeat(1021)}:1521`)).toBeNull()
    expect(oracleConnectProxyInternals.parseConnectTarget('db.example.com /:1521')).toBeNull()
    expect(validationMocks.validateDatabaseHost).not.toHaveBeenCalled()
  })

  it('bounds the complete HTTP CONNECT header', async () => {
    const proxy = await createOracleConnectProxy(5000)
    const response = await sendRawConnect(
      proxy.port,
      `CONNECT db.example.com:1521 HTTP/1.1\r\nX-Padding: ${'x'.repeat(8192)}\r\n\r\n`
    )

    expect(response).toContain('431 Request Header Fields Too Large')
    expect(validationMocks.validateDatabaseHost).not.toHaveBeenCalled()
    await proxy.close()
  })

  it('allows at most eight redirect tunnels for one operation', async () => {
    validationMocks.validateDatabaseHost.mockResolvedValue({
      isValid: false,
      error: 'blocked for test',
    })
    const proxy = await createOracleConnectProxy(5000)

    for (let index = 0; index < 8; index += 1) {
      await expect(
        sendRawConnect(proxy.port, `CONNECT redirect-${index}.example.com:1521 HTTP/1.1\r\n\r\n`)
      ).resolves.toContain('403 CONNECT Target Blocked')
    }
    await expect(
      sendRawConnect(proxy.port, 'CONNECT redirect-8.example.com:1521 HTTP/1.1\r\n\r\n')
    ).resolves.toContain('429 Too Many CONNECT Requests')

    expect(validationMocks.validateDatabaseHost).toHaveBeenCalledTimes(8)
    expect(proxy.getFailureReason()).toContain('redirect tunnel limit')
    await proxy.close()
  })

  it('drops connections beyond the two-active-tunnel ceiling', async () => {
    const upstreamSockets = new Set<net.Socket>()
    const upstream = net.createServer((socket) => {
      upstreamSockets.add(socket)
      socket.once('close', () => upstreamSockets.delete(socket))
    })
    const upstreamPort = await listen(upstream)
    validationMocks.validateDatabaseHost.mockResolvedValue({
      isValid: true,
      resolvedIP: '127.0.0.1',
      originalHostname: 'db.example.com',
    })
    const proxy = await createOracleConnectProxy(5000)
    const clients = [new net.Socket(), new net.Socket()]

    for (const client of clients) {
      client.connect(proxy.port, proxy.host)
      await once(client, 'connect')
      client.write(`CONNECT db.example.com:${upstreamPort} HTTP/1.1\r\n\r\n`)
      const [response] = (await once(client, 'data')) as [Buffer]
      expect(response.toString()).toContain('200 Connection Established')
    }

    const overflowResponse = await sendRawConnect(
      proxy.port,
      `CONNECT db.example.com:${upstreamPort} HTTP/1.1\r\n\r\n`
    )
    expect(overflowResponse).not.toContain('200 Connection Established')
    expect(validationMocks.validateDatabaseHost).toHaveBeenCalledTimes(2)

    for (const client of clients) client.destroy()
    for (const socket of upstreamSockets) socket.destroy()
    await proxy.close()
  })

  it('times out a stalled upstream dial and cleans up both sockets', async () => {
    validationMocks.validateDatabaseHost.mockResolvedValue({
      isValid: true,
      resolvedIP: '203.0.113.10',
      originalHostname: 'db.example.com',
    })
    const proxy = await createOracleConnectProxy(25)
    const client = new net.Socket()
    client.connect(proxy.port, proxy.host)
    await once(client, 'connect')
    const responsePromise = new Promise<string>((resolve) => {
      const chunks: Buffer[] = []
      client.on('data', (chunk: Buffer) => chunks.push(chunk))
      client.once('close', () => resolve(Buffer.concat(chunks).toString()))
    })
    const stalledUpstream = new net.Socket()
    const createConnection = vi.spyOn(net, 'createConnection').mockImplementation(() => {
      queueMicrotask(() => stalledUpstream.emit('timeout'))
      return stalledUpstream
    })

    client.write('CONNECT db.example.com:1521 HTTP/1.1\r\n\r\n')
    const response = await responsePromise

    expect(response).not.toContain('200 Connection Established')
    expect(createConnection).toHaveBeenCalledWith({ host: '203.0.113.10', port: 1521 })
    expect(proxy.getFailureReason()).toContain('timed out after 25 ms')
    expect(client.destroyed).toBe(true)
    expect(stalledUpstream.destroyed).toBe(true)
    await proxy.close()
  })

  it('aborting the operation closes the listener and every active tunnel', async () => {
    let resolveUpstream: ((socket: net.Socket) => void) | undefined
    const upstreamSocket = new Promise<net.Socket>((resolve) => {
      resolveUpstream = resolve
    })
    const upstream = net.createServer((socket) => resolveUpstream?.(socket))
    const upstreamPort = await listen(upstream)
    validationMocks.validateDatabaseHost.mockResolvedValue({
      isValid: true,
      resolvedIP: '127.0.0.1',
      originalHostname: 'db.example.com',
    })
    const controller = new AbortController()
    const proxy = await createOracleConnectProxy(5000, controller.signal)
    const client = new net.Socket()
    client.connect(proxy.port, proxy.host)
    await once(client, 'connect')
    client.write(`CONNECT db.example.com:${upstreamPort} HTTP/1.1\r\n\r\n`)
    const [response] = (await once(client, 'data')) as [Buffer]
    expect(response.toString()).toContain('200 Connection Established')

    const acceptedUpstream = await upstreamSocket
    const clientClosed = once(client, 'close')
    const upstreamClosed = once(acceptedUpstream, 'close')
    controller.abort()

    await Promise.all([clientClosed, upstreamClosed, proxy.close()])
    expect(client.destroyed).toBe(true)
    expect(acceptedUpstream.destroyed).toBe(true)
  })
})

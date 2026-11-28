/**
 * Encrypted connections against a real loopback TLS listener: what reaches the wire (address,
 * SNI, first Bolt bytes) is only observable on a socket.
 */
import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { type AddressInfo, connect as connectTcp, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createServer as createTlsServer,
  getCACertificates,
  setDefaultCACertificates,
} from 'node:tls'
import { promisify } from 'node:util'
import {
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing/mocks/input-validation.mock'
import { Neo4jError } from 'neo4j-driver'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

/** The relay's own server and sockets, observed (not replaced) so a test can fail them directly. */
const relayHandles = vi.hoisted(() => ({
  servers: [] as Server[],
  clients: [] as Socket[],
  upstreams: [] as Socket[],
}))

vi.mock('node:net', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:net')>()
  const createServer = ((...args: Parameters<typeof actual.createServer>) => {
    const server = actual.createServer(...args)
    server.on('connection', (socket) => relayHandles.clients.push(socket))
    relayHandles.servers.push(server)
    return server
  }) as typeof actual.createServer
  return { ...actual, createServer }
})

vi.mock('node:tls', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:tls')>()
  const connect = ((...args: Parameters<typeof actual.connect>) => {
    const socket = actual.connect(...args)
    relayHandles.upstreams.push(socket)
    return socket
  }) as typeof actual.connect
  return { ...actual, connect }
})

import { openNeo4jConnection } from '@/lib/internal/neo4j/client'

/** `.invalid` never resolves, so only a connection pinned to the validated IP can reach the server. */
const DATABASE_HOST = 'neo4j.invalid'
const BOLT_MAGIC = '6060b017'

interface TlsDatabase {
  port: number
  /** SNI and first application bytes of every TLS session that completed. */
  sessions: Array<{ servername: string | undefined; firstBytes: string }>
  openSockets: () => number
  close: () => Promise<void>
}

const certificateDirectory = mkdtempSync(join(tmpdir(), 'neo4j-tls-'))
const certificates: Record<string, { cert: string; key: string }> = {}
const defaultCertificates = getCACertificates('default')

async function issueCertificate(name: string) {
  const certPath = join(certificateDirectory, `${name}.crt`)
  const keyPath = join(certificateDirectory, `${name}.key`)
  await promisify(execFile)('openssl', [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-sha256',
    '-nodes',
    '-keyout',
    keyPath,
    '-out',
    certPath,
    '-days',
    '2',
    '-subj',
    `/CN=${name}`,
    '-addext',
    `subjectAltName=DNS:${name}`,
  ])
  certificates[name] = { cert: readFileSync(certPath, 'utf8'), key: readFileSync(keyPath, 'utf8') }
}

/**
 * A TLS listener that records the session, then hangs up: enough to see what the driver sent.
 * With `holdOpen` it never answers, so the driver stays mid-handshake until the relay fails.
 */
async function startTlsDatabase(
  certificateName: string,
  { holdOpen = false } = {}
): Promise<TlsDatabase> {
  const sessions: TlsDatabase['sessions'] = []
  const sockets = new Set<Socket>()
  const server = createTlsServer(certificates[certificateName], (socket) => {
    socket.once('data', (chunk: Buffer) => {
      sessions.push({
        servername: socket.servername || undefined,
        firstBytes: chunk.subarray(0, 4).toString('hex'),
      })
      if (!holdOpen) socket.destroy()
    })
  })
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  server.on('tlsClientError', () => {})
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    port: (server.address() as AddressInfo).port,
    sessions,
    openSockets: () => sockets.size,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy()
        server.close(() => resolve())
      }),
  }
}

describe('openNeo4jConnection with encryption enabled', () => {
  beforeAll(async () => {
    await issueCertificate(DATABASE_HOST)
    await issueCertificate('other.invalid')
    setDefaultCACertificates([
      ...defaultCertificates,
      certificates[DATABASE_HOST].cert,
      certificates['other.invalid'].cert,
    ])
  })

  afterAll(() => {
    setDefaultCACertificates(defaultCertificates)
    rmSync(certificateDirectory, { recursive: true, force: true })
  })

  beforeEach(() => {
    relayHandles.servers.length = 0
    relayHandles.clients.length = 0
    relayHandles.upstreams.length = 0
    inputValidationMockFns.mockValidateDatabaseHost.mockResolvedValue({
      isValid: true,
      resolvedIP: '127.0.0.1',
      originalHostname: DATABASE_HOST,
    })
  })

  const open = (port: number) =>
    openNeo4jConnection({
      host: DATABASE_HOST,
      port,
      database: 'neo4j',
      username: 'neo4j',
      password: 'secret',
      encryption: 'enabled',
    })

  it('carries Bolt over TLS to the validated IP with the hostname as SNI', async () => {
    const database = await startTlsDatabase(DATABASE_HOST)
    try {
      await expect(open(database.port)).rejects.toThrow()
      expect(database.sessions[0]).toEqual({ servername: DATABASE_HOST, firstBytes: BOLT_MAGIC })
    } finally {
      await database.close()
    }
  })

  it('refuses a certificate issued for another hostname before sending any Bolt bytes', async () => {
    const database = await startTlsDatabase('other.invalid')
    try {
      const error = await open(database.port).catch((caught: unknown) => caught)
      expect(error).toBeInstanceOf(Neo4jError)
      expect(error).toMatchObject({
        code: 'ServiceUnavailable',
        message: expect.stringMatching(
          /Failed to connect to server.*Caused by: Hostname\/IP does not match certificate's altnames/
        ),
      })
      expect(database.sessions).toEqual([])
    } finally {
      await database.close()
    }
  })

  /** Opens through a database that never answers and waits until Bolt bytes cross the relay. */
  async function openMidHandshake() {
    const database = await startTlsDatabase(DATABASE_HOST, { holdOpen: true })
    const opening = open(database.port).catch((caught: unknown) => caught)
    await vi.waitFor(() => expect(database.sessions).toHaveLength(1))
    return { database, opening }
  }

  it('closes the relay and fails the connection when its server errors after listening', async () => {
    const { database, opening } = await openMidHandshake()
    try {
      const [server] = relayHandles.servers
      const port = (server.address() as AddressInfo).port
      const failure = Object.assign(new Error('accept EMFILE'), { code: 'EMFILE' })

      expect(() => server.emit('error', failure)).not.toThrow()

      const error = await opening
      expect(error).toBeInstanceOf(Neo4jError)
      expect(error).toMatchObject({
        message: expect.stringMatching(/Failed to connect to server.*Caused by: accept EMFILE/),
      })
      expect(server.listening).toBe(false)
      await vi.waitFor(() => expect(database.openSockets()).toBe(0))
      const refused = await new Promise<unknown>((resolve) => {
        const probe = connectTcp(port, '127.0.0.1', () => resolve(undefined))
        probe.once('error', resolve)
      })
      expect(refused).toMatchObject({ code: 'ECONNREFUSED' })
    } finally {
      await database.close()
    }
  })

  it.each(['clients', 'upstreams'] as const)(
    'survives a relayed socket (%s) emitting error more than once',
    async (side) => {
      const { database, opening } = await openMidHandshake()
      try {
        const [socket] = relayHandles[side]
        const failure = new Error('connection reset')

        expect(() => {
          socket.emit('error', failure)
          socket.emit('error', failure)
        }).not.toThrow()

        expect(await opening).toBeInstanceOf(Neo4jError)
        await vi.waitFor(() => expect(database.openSockets()).toBe(0))
      } finally {
        await database.close()
      }
    }
  )
})

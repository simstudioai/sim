import { createServer as createTcpServer, isIP, type Socket } from 'node:net'
import { checkServerIdentity, connect as connectTls } from 'node:tls'
import { createLogger } from '@sim/logger'
import neo4j, { type Driver } from 'neo4j-driver'
import { validateDatabaseHost } from '@/lib/core/security/input-validation.server'
import type { Neo4jConnectionConfig } from '@/tools/neo4j/types'

const logger = createLogger('Neo4jClient')

const CONNECTION_TIMEOUT_MS = 10_000
/** The driver pools one connection; the rest of the budget covers reconnects after a drop. */
const MAX_RELAYED_CONNECTIONS = 4
const CONNECT_FAILURE_PREFIX =
  'Failed to connect to server. Please ensure that your database is listening on the correct host and port and that you have compatible encryption settings both on Neo4j server and driver.'

/** An open Neo4j driver and everything that must be released with it. */
interface Neo4jConnection {
  driver: Driver
  close: () => Promise<void>
}

interface PinnedTlsRelay {
  port: number
  failure: () => Error | undefined
  close: () => Promise<void>
}

function isAuraHost(host: string): boolean {
  return host === 'databases.neo4j.io' || host.endsWith('.databases.neo4j.io')
}

/**
 * Accepts the driver's plaintext Bolt on loopback and carries it over TLS to the already
 * validated `address`, sending `serverName` as SNI and verifying the certificate against it.
 *
 * The driver's direct `bolt+s` channel connects by name, so the host would be resolved again
 * after validation (DNS rebinding), and neo4j-driver has no supported way to pin the address
 * while keeping hostname verification. The relay owns TLS instead, against the pinned IP.
 */
async function startPinnedTlsRelay(target: {
  address: string
  port: number
  serverName: string
}): Promise<PinnedTlsRelay> {
  const sockets = new Set<Socket>()
  let accepted = 0
  let lastFailure: Error | undefined
  let closePromise: Promise<void> | undefined

  const close = () => {
    closePromise ??= new Promise<void>((resolve) => {
      for (const socket of sockets) socket.destroy()
      server.close(() => resolve())
    })
    return closePromise
  }

  const server = createTcpServer((client) => {
    accepted += 1
    sockets.add(client)
    client.once('close', () => sockets.delete(client))
    if (accepted > MAX_RELAYED_CONNECTIONS) {
      client.destroy()
      return
    }

    const upstream = connectTls({
      host: target.address,
      port: target.port,
      servername: isIP(target.serverName) ? undefined : target.serverName,
      checkServerIdentity: (_name, certificate) =>
        checkServerIdentity(target.serverName, certificate),
      rejectUnauthorized: true,
    })
    sockets.add(upstream)
    upstream.setNoDelay(true)
    upstream.setTimeout(CONNECTION_TIMEOUT_MS)

    const finish = () => {
      sockets.delete(upstream)
      client.destroy()
      upstream.destroy()
    }
    upstream.once('secureConnect', () => {
      upstream.setTimeout(0)
      client.pipe(upstream)
      upstream.pipe(client)
    })
    upstream.once('timeout', () => {
      lastFailure = new Error(`Failed to establish connection in ${CONNECTION_TIMEOUT_MS}ms`)
      finish()
    })
    upstream.on('error', (error) => {
      lastFailure = error
      finish()
    })
    upstream.once('close', finish)
    client.on('error', finish)
    client.once('close', finish)
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject)
      server.on('error', (error: NodeJS.ErrnoException) => {
        logger.error('Neo4j TLS relay server failed; closing the relay', {
          code: error.code,
          error: error.message,
        })
        lastFailure = error
        void close()
      })
      resolve()
    })
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    await close()
    throw new Error('Neo4j TLS relay did not bind a TCP port')
  }

  return { port: address.port, failure: () => lastFailure, close }
}

/**
 * Opens a verified Neo4j driver for a validated host.
 *
 * - Encryption off: plain `bolt` straight to the validated IP.
 * - Encryption on: plain `bolt` to {@link startPinnedTlsRelay}, which reaches the validated IP
 *   over TLS with SNI and certificate hostname verification against the configured host.
 * - Aura (`*.databases.neo4j.io`): the driver's own `neo4j+s` routing, by name. Those hosts and
 *   the routing table they return are operated by Neo4j, not chosen by the caller.
 */
export async function openNeo4jConnection(
  config: Neo4jConnectionConfig,
  signal?: AbortSignal
): Promise<Neo4jConnection> {
  signal?.throwIfAborted()
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65_535) {
    throw new Error('Port must be an integer between 1 and 65535')
  }
  const hostValidation = await validateDatabaseHost(config.host, 'host')
  signal?.throwIfAborted()
  if (!hostValidation.isValid) throw new Error(hostValidation.error)

  const aura = isAuraHost(config.host)
  const resolvedHost = hostValidation.resolvedIP ?? config.host
  const relay =
    !aura && config.encryption === 'enabled'
      ? await startPinnedTlsRelay({
          address: resolvedHost,
          port: config.port,
          serverName: config.host.replace(/^\[|\]$/g, ''),
        })
      : undefined
  if (signal?.aborted) {
    await relay?.close()
    signal.throwIfAborted()
  }

  let uri: string
  if (aura) {
    uri = `neo4j+s://${config.host}:${config.port}`
  } else if (relay) {
    uri = `bolt://127.0.0.1:${relay.port}`
  } else {
    uri = `bolt://${resolvedHost.includes(':') ? `[${resolvedHost}]` : resolvedHost}:${config.port}`
  }
  const driverConfig: Exclude<Parameters<typeof neo4j.driver>[2], undefined> = {
    maxConnectionPoolSize: 1,
    connectionTimeout: CONNECTION_TIMEOUT_MS,
  }
  if (!aura) driverConfig.encrypted = 'ENCRYPTION_OFF'

  const driver = neo4j.driver(uri, neo4j.auth.basic(config.username, config.password), driverConfig)
  const close = async () => {
    try {
      await driver.close()
    } finally {
      await relay?.close()
    }
  }
  const abort = () => {
    void close()
  }
  signal?.addEventListener('abort', abort, { once: true })
  try {
    await driver.verifyConnectivity()
    signal?.throwIfAborted()
    return { driver, close }
  } catch (error) {
    await close().catch(() => undefined)
    const relayFailure = relay?.failure()
    if (relayFailure && !signal?.aborted && error instanceof neo4j.Neo4jError) {
      error.message = `${CONNECT_FAILURE_PREFIX} Caused by: ${relayFailure.message}`
      error.cause = relayFailure
    }
    throw error
  } finally {
    signal?.removeEventListener('abort', abort)
  }
}

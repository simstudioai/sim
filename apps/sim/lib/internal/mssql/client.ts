import net from 'node:net'
import sql from 'mssql'
import { validateDatabaseHost } from '@/lib/core/security/input-validation.server'

export interface MSSQLConnectionConfig {
  host: string
  port: number
  database: string
  username: string
  password: string
  encrypt: 'enabled' | 'disabled'
  trustServerCertificate: 'enabled' | 'disabled'
  connectionTimeout: number
}

/**
 * Opens a TCP socket to an already-validated IP address.
 *
 * Tedious calls the `connector` instead of resolving and connecting itself, so
 * this is what keeps the connection pinned to the address the SSRF guard
 * approved rather than to whatever DNS answers a second time.
 * @see https://tediousjs.github.io/tedious/api-connection.html
 */
function connectToPinnedAddress(
  address: string,
  port: number,
  timeoutMs: number,
  signal?: AbortSignal
) {
  signal?.throwIfAborted()

  return new Promise<net.Socket>((resolve, reject) => {
    const socket = net.connect({ host: address, port })
    socket.setNoDelay(true)
    socket.setTimeout(timeoutMs)

    const cleanup = () => {
      signal?.removeEventListener('abort', abort)
      socket.removeListener('timeout', timeout)
      socket.removeListener('error', fail)
    }
    const fail = (error: Error) => {
      cleanup()
      socket.destroy()
      reject(error)
    }
    const timeout = () => fail(new Error(`Connection to ${address}:${port} timed out`))
    const abort = () => {
      cleanup()
      socket.destroy()
      reject(signal?.reason ?? new DOMException('The operation was aborted', 'AbortError'))
    }

    socket.once('connect', () => {
      cleanup()
      socket.setTimeout(0)
      resolve(socket)
    })
    socket.once('timeout', timeout)
    socket.once('error', fail)
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
  })
}

/**
 * Opens a single-connection `mssql` pool against the SSRF-validated address.
 *
 * `options.connector` supplies a socket already connected to the resolved IP,
 * which closes the DNS-rebinding window the way the PostgreSQL and MySQL tools
 * do. `server` stays the original hostname because tedious derives the TLS
 * `servername` from it independently of the connector, so SNI and certificate
 * validation are unaffected by the pin.
 *
 * Named instances are deliberately unsupported: tedious resolves them with a
 * UDP SQL Server Browser lookup issued against the hostname *outside* the
 * connector, and node-mssql deletes `port` whenever `instanceName` is set, so
 * there is no configuration in which a named instance stays pinned. Connect to
 * a named instance by giving it a static TCP port instead.
 *
 * An Azure SQL `Redirect` routing response is unsupported for the same reason
 * and fails the same safe way. tedious reconnects on a LOGIN7 routing envchange,
 * but a zero-argument connector ignores the redirect target and reconnects to
 * the pinned address — which is the behavior we want, since the redirect target
 * is chosen by the server and honoring it would be the rebinding the pin exists
 * to stop. Reach Azure SQL through a `Proxy`-policy connection.
 *
 * `requestTimeout` intentionally tracks `connectionTimeout` off the single knob
 * the block exposes, which the field labels as covering both. tedious governs
 * the whole login handshake (prelogin, TLS, LOGIN7) with `connectTimeout`
 * regardless of the connector, so the socket's own timeout is cleared once it is
 * connected rather than left to fire during a slow login.
 * @see https://tediousjs.github.io/tedious/api-connection.html
 * @see https://github.com/tediousjs/node-mssql#general-same-for-all-drivers
 */
export async function createMSSQLConnection(
  config: MSSQLConnectionConfig,
  signal?: AbortSignal
): Promise<sql.ConnectionPool> {
  signal?.throwIfAborted()
  const hostValidation = await validateDatabaseHost(config.host, 'host')
  signal?.throwIfAborted()
  if (!hostValidation.isValid) {
    throw new Error(hostValidation.error)
  }

  const pinnedAddress = hostValidation.resolvedIP ?? config.host

  const pool = new sql.ConnectionPool({
    server: config.host,
    port: config.port,
    database: config.database,
    user: config.username,
    password: config.password,
    connectionTimeout: config.connectionTimeout,
    requestTimeout: config.connectionTimeout,
    pool: {
      max: 1,
      min: 0,
      idleTimeoutMillis: 20000,
    },
    options: {
      encrypt: config.encrypt === 'enabled',
      trustServerCertificate: config.trustServerCertificate === 'enabled',
      connector: () =>
        connectToPinnedAddress(pinnedAddress, config.port, config.connectionTimeout, signal),
    },
  })

  let rejectAbort: ((reason: unknown) => void) | undefined
  const aborted = signal
    ? new Promise<never>((_, reject) => {
        rejectAbort = reject
      })
    : undefined
  const abortConnection = () => {
    void pool.close().catch(() => {})
    rejectAbort?.(signal?.reason ?? new DOMException('The operation was aborted', 'AbortError'))
  }
  signal?.addEventListener('abort', abortConnection, { once: true })

  try {
    const connect = pool.connect()
    await (aborted ? Promise.race([connect, aborted]) : connect)
    signal?.throwIfAborted()
  } catch (error) {
    /**
     * Only a pool that was handed back gets closed by the route's `finally`, so
     * a pool that failed to connect has to release its own tarn resources here
     * or a bad credential retried in a loop leaks one every attempt. `close()`
     * on a pool that never connected is a no-op rather than an error, and its
     * own failure must not mask the connect error the caller needs to see.
     */
    await pool.close().catch(() => {})
    signal?.throwIfAborted()
    throw error
  } finally {
    signal?.removeEventListener('abort', abortConnection)
  }

  return pool
}

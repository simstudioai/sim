import { createHash } from 'node:crypto'
import { createLogger } from '@sim/logger'
import { safeCompare } from '@sim/security/compare'
import { toError } from '@sim/utils/errors'
import { type Attributes, Client, type ConnectConfig, type SFTPWrapper } from 'ssh2'
import { validateDatabaseHost } from '@/lib/core/security/input-validation.server'
import { readNodeStreamToBufferWithLimit } from '@/lib/core/utils/stream-limits'

const logger = createLogger('SftpClient')
const S_IFMT = 0o170000
const S_IFDIR = 0o040000
const S_IFREG = 0o100000
const S_IFLNK = 0o120000

export interface SftpConnectionConfig {
  host: string
  port: number
  username: string
  password?: string | null
  privateKey?: string | null
  passphrase?: string | null
  timeout?: number
  keepaliveInterval?: number
  readyTimeout?: number
  hostFingerprint?: string | null
  signal?: AbortSignal
}

function normalizeSha256Fingerprint(value: string): string {
  return value
    .trim()
    .replace(/^sha256:/i, '')
    .replace(/=+$/, '')
    .trim()
}

function computeHostKeyFingerprint(hostKey: Buffer): string {
  return createHash('sha256').update(hostKey).digest('base64').replace(/=+$/, '')
}

function formatSftpError(err: Error, config: { host: string; port: number }): Error {
  const errorMessage = err.message.toLowerCase()
  const { host, port } = config

  if (errorMessage.includes('econnrefused') || errorMessage.includes('connection refused')) {
    return new Error(
      `Connection refused to ${host}:${port}. Please verify: (1) SSH/SFTP server is running, (2) Port ${port} is correct, (3) Firewall allows connections.`
    )
  }
  if (errorMessage.includes('econnreset') || errorMessage.includes('connection reset')) {
    return new Error(
      `Connection reset by ${host}:${port}. This usually means: (1) Wrong port number, (2) Server rejected the connection, (3) Network/firewall interrupted the connection.`
    )
  }
  if (errorMessage.includes('etimedout') || errorMessage.includes('timeout')) {
    return new Error(
      `Connection timed out to ${host}:${port}. Please verify: (1) Host is reachable, (2) No firewall is blocking the connection, (3) The SFTP server is responding.`
    )
  }
  if (errorMessage.includes('enotfound') || errorMessage.includes('getaddrinfo')) {
    return new Error(
      `Could not resolve hostname "${host}". Please verify the hostname or IP address is correct.`
    )
  }
  if (errorMessage.includes('authentication') || errorMessage.includes('auth')) {
    return new Error(
      `Authentication failed on ${host}:${port}. Please verify: (1) Username is correct, (2) Password or private key is valid, (3) User has SFTP access on the server.`
    )
  }
  if (
    errorMessage.includes('key') &&
    (errorMessage.includes('parse') || errorMessage.includes('invalid'))
  ) {
    return new Error(
      'Invalid private key format. Please ensure you\'re using a valid OpenSSH private key (starts with "-----BEGIN" and ends with "-----END").'
    )
  }
  if (errorMessage.includes('host key') || errorMessage.includes('hostkey')) {
    return new Error(
      `Host key verification issue for ${host}. This may be the first connection or the server's key has changed.`
    )
  }
  return new Error(`SFTP connection to ${host}:${port} failed: ${err.message}`)
}

export async function createSftpConnection(config: SftpConnectionConfig): Promise<Client> {
  const host = config.host
  if (!host || host.trim() === '') {
    throw new Error('Host is required. Please provide a valid hostname or IP address.')
  }
  config.signal?.throwIfAborted()

  const hostValidation = await validateDatabaseHost(host, 'host')
  config.signal?.throwIfAborted()
  if (!hostValidation.isValid) throw new Error(hostValidation.error)

  const resolvedHost = hostValidation.resolvedIP ?? host.trim()

  return new Promise((resolve, reject) => {
    const client = new Client()
    const port = config.port || 22
    const hasPassword = Boolean(config.password?.trim())
    const hasPrivateKey = Boolean(config.privateKey?.trim())
    let ready = false
    let settled = false

    const cleanupBeforeReady = () => {
      client.off('ready', onReady)
      client.off('timeout', onTimeout)
    }
    const fail = (error: Error) => {
      if (ready || settled) return
      settled = true
      cleanupBeforeReady()
      config.signal?.removeEventListener('abort', onAbort)
      reject(error)
    }
    const onAbort = () => {
      const error = toError(config.signal?.reason ?? new Error('Aborted'))
      if (!ready) fail(error)
      client.destroy()
    }
    const onReady = () => {
      if (settled) return
      settled = true
      ready = true
      client.off('ready', onReady)
      resolve(client)
    }
    let hostKeyRejection: Error | undefined
    const onError = (error: Error) => {
      fail(hostKeyRejection ?? formatSftpError(error, { host, port }))
    }
    const onTimeout = () => {
      client.destroy()
      fail(
        new Error(
          `Connection to ${host}:${port} timed out after ${config.timeout}ms of inactivity.`
        )
      )
    }

    if (!hasPassword && !hasPrivateKey) {
      fail(new Error('Authentication required. Please provide either a password or private key.'))
      return
    }

    const connectConfig: ConnectConfig = { host: resolvedHost, port, username: config.username }
    if (config.readyTimeout !== undefined) connectConfig.readyTimeout = config.readyTimeout
    if (config.keepaliveInterval !== undefined) {
      connectConfig.keepaliveInterval = config.keepaliveInterval
    }
    if (config.timeout !== undefined) connectConfig.timeout = config.timeout

    const suppliedFingerprint = config.hostFingerprint?.trim()
    const expectedFingerprint = suppliedFingerprint
      ? normalizeSha256Fingerprint(suppliedFingerprint)
      : undefined
    if (suppliedFingerprint && !expectedFingerprint) {
      fail(
        new Error(
          'Host key fingerprint is not a valid SHA-256 fingerprint. Expected the base64 form printed by `ssh-keyscan <host> | ssh-keygen -lf -`.'
        )
      )
      return
    }
    if (expectedFingerprint) {
      connectConfig.hostVerifier = (hostKey: Buffer): boolean => {
        const actualFingerprint = computeHostKeyFingerprint(hostKey)
        if (safeCompare(actualFingerprint, expectedFingerprint)) return true
        hostKeyRejection = new Error(
          `Host key verification failed for ${host}:${port}. Expected SHA256:${expectedFingerprint} but the server presented SHA256:${actualFingerprint}. Either the server's host key changed, or the connection was intercepted. Re-run "ssh-keyscan -t rsa,ecdsa,ed25519 ${host}" to confirm the current key before updating the fingerprint.`
        )
        logger.warn('SFTP host key fingerprint mismatch', { host, port })
        return false
      }
    }

    if (hasPrivateKey) {
      connectConfig.privateKey = config.privateKey ?? undefined
      if (config.passphrase?.trim()) connectConfig.passphrase = config.passphrase
    } else {
      connectConfig.password = config.password ?? undefined
    }

    client.on('ready', onReady)
    client.on('error', onError)
    client.on('timeout', onTimeout)
    client.once('close', () => config.signal?.removeEventListener('abort', onAbort))
    config.signal?.addEventListener('abort', onAbort, { once: true })

    if (config.signal?.aborted) {
      onAbort()
      return
    }
    try {
      client.connect(connectConfig)
    } catch (error) {
      fail(formatSftpError(toError(error), { host, port }))
    }
  })
}

export function getSftp(client: Client, signal?: AbortSignal): Promise<SFTPWrapper> {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      callback()
    }
    const onAbort = () => {
      finish(() => reject(toError(signal?.reason ?? new Error('Aborted'))))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) {
      onAbort()
      return
    }
    client.sftp((error, sftp) => {
      if (signal?.aborted) {
        onAbort()
      } else if (error) {
        finish(() => reject(new Error(`Failed to start SFTP session: ${error.message}`)))
      } else {
        finish(() => resolve(sftp))
      }
    })
  })
}

export const MAX_SFTP_READ_BYTES = 50 * 1024 * 1024

export function readSftpFileCapped(
  sftp: SFTPWrapper,
  remotePath: string,
  maxBytes: number,
  label: string,
  signal?: AbortSignal
): Promise<Buffer> {
  signal?.throwIfAborted()
  const stream = sftp.createReadStream(remotePath)
  stream.on('error', () => {})
  return readNodeStreamToBufferWithLimit(stream, { maxBytes, label, signal })
}

export function sanitizePath(path: string): string {
  return decodeURIComponent(path.replace(/\0/g, '')).replace(/\\/g, '/').replace(/\/+/g, '/').trim()
}

export function sanitizeFileName(fileName: string): string {
  let sanitized = fileName.replace(/\0/g, '')
  try {
    sanitized = decodeURIComponent(sanitized)
  } catch {}
  sanitized = sanitized
    .replace(/[/\\]+/g, '_')
    .replace(/^\.+/, '')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .trim()
  return sanitized || 'unnamed_file'
}

export function isPathSafe(path: string): boolean {
  const normalizedPath = path.replace(/\\/g, '/')
  if (normalizedPath.includes('../') || normalizedPath.includes('..\\')) return false
  try {
    const decoded = decodeURIComponent(normalizedPath)
    if (decoded.includes('../') || decoded.includes('..\\')) return false
  } catch {
    return false
  }
  return !normalizedPath.includes('\0')
}

export function parsePermissions(mode: number): string {
  return `0${(mode & 0o777).toString(8)}`
}

export function getFileType(attrs: Attributes): 'file' | 'directory' | 'symlink' | 'other' {
  const fileType = attrs.mode & S_IFMT
  if (fileType === S_IFDIR) return 'directory'
  if (fileType === S_IFREG) return 'file'
  if (fileType === S_IFLNK) return 'symlink'
  return 'other'
}

export function sftpExists(
  sftp: SFTPWrapper,
  path: string,
  signal?: AbortSignal
): Promise<boolean> {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      callback()
    }
    const onAbort = () => {
      finish(() => reject(toError(signal?.reason ?? new Error('Aborted'))))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) {
      onAbort()
      return
    }
    sftp.stat(path, (error) => {
      if (signal?.aborted) onAbort()
      else finish(() => resolve(!error))
    })
  })
}

export function sftpIsDirectory(
  sftp: SFTPWrapper,
  path: string,
  signal?: AbortSignal
): Promise<boolean> {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      callback()
    }
    const onAbort = () => {
      finish(() => reject(toError(signal?.reason ?? new Error('Aborted'))))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) {
      onAbort()
      return
    }
    sftp.stat(path, (error, stats) => {
      if (signal?.aborted) onAbort()
      else finish(() => resolve(!error && getFileType(stats) === 'directory'))
    })
  })
}

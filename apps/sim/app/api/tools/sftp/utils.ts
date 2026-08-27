import { createHash } from 'node:crypto'
import { createLogger } from '@sim/logger'
import { safeCompare } from '@sim/security/compare'
import { toError } from '@sim/utils/errors'
import { type Attributes, Client, type ConnectConfig, type SFTPWrapper } from 'ssh2'
import { validateDatabaseHost } from '@/lib/core/security/input-validation.server'
import { readNodeStreamToBufferWithLimit } from '@/lib/core/utils/stream-limits'

const logger = createLogger('SftpUtils')

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
  /**
   * Idle socket timeout in ms, forwarded to ssh2's `sock.setTimeout`. Left
   * unset the socket has no idle timeout at all (ssh2 defaults it to `0`).
   */
  timeout?: number
  keepaliveInterval?: number
  readyTimeout?: number
  /**
   * Expected SHA-256 host key fingerprint in the format `ssh-keyscan` and
   * OpenSSH print (`SHA256:<base64>`). The `SHA256:` prefix and any base64
   * padding are optional. When set, a server presenting a different host key is
   * rejected before authentication runs. When omitted, the host is not
   * verified — ssh2's default behavior.
   */
  hostFingerprint?: string | null
}

/**
 * Normalizes a user-supplied SHA-256 fingerprint for comparison: trims, drops
 * an optional `SHA256:` prefix, and strips base64 `=` padding, which OpenSSH
 * omits but copy/paste sources sometimes include.
 */
function normalizeSha256Fingerprint(value: string): string {
  return value
    .trim()
    .replace(/^sha256:/i, '')
    .replace(/=+$/, '')
    .trim()
}

/**
 * Computes the OpenSSH SHA-256 fingerprint of a host key. ssh2 hands the
 * verifier the raw SSH wire-format public key blob — the same bytes OpenSSH
 * base64-encodes into `known_hosts` — so hashing it directly reproduces the
 * unpadded base64 digest that `ssh-keyscan | ssh-keygen -lf -` prints.
 */
function computeHostKeyFingerprint(hostKey: Buffer): string {
  return createHash('sha256').update(hostKey).digest('base64').replace(/=+$/, '')
}

/**
 * Formats SSH/SFTP errors with helpful troubleshooting context
 */
function formatSftpError(err: Error, config: { host: string; port: number }): Error {
  const errorMessage = err.message.toLowerCase()
  const { host, port } = config

  if (errorMessage.includes('econnrefused') || errorMessage.includes('connection refused')) {
    return new Error(
      `Connection refused to ${host}:${port}. ` +
        `Please verify: (1) SSH/SFTP server is running, ` +
        `(2) Port ${port} is correct, ` +
        `(3) Firewall allows connections.`
    )
  }

  if (errorMessage.includes('econnreset') || errorMessage.includes('connection reset')) {
    return new Error(
      `Connection reset by ${host}:${port}. ` +
        `This usually means: (1) Wrong port number, ` +
        `(2) Server rejected the connection, ` +
        `(3) Network/firewall interrupted the connection.`
    )
  }

  if (errorMessage.includes('etimedout') || errorMessage.includes('timeout')) {
    return new Error(
      `Connection timed out to ${host}:${port}. ` +
        `Please verify: (1) Host is reachable, ` +
        `(2) No firewall is blocking the connection, ` +
        `(3) The SFTP server is responding.`
    )
  }

  if (errorMessage.includes('enotfound') || errorMessage.includes('getaddrinfo')) {
    return new Error(
      `Could not resolve hostname "${host}". Please verify the hostname or IP address is correct.`
    )
  }

  if (errorMessage.includes('authentication') || errorMessage.includes('auth')) {
    return new Error(
      `Authentication failed on ${host}:${port}. ` +
        `Please verify: (1) Username is correct, ` +
        `(2) Password or private key is valid, ` +
        `(3) User has SFTP access on the server.`
    )
  }

  if (
    errorMessage.includes('key') &&
    (errorMessage.includes('parse') || errorMessage.includes('invalid'))
  ) {
    return new Error(
      `Invalid private key format. ` +
        `Please ensure you're using a valid OpenSSH private key ` +
        `(starts with "-----BEGIN" and ends with "-----END").`
    )
  }

  if (errorMessage.includes('host key') || errorMessage.includes('hostkey')) {
    return new Error(
      `Host key verification issue for ${host}. ` +
        `This may be the first connection or the server's key has changed.`
    )
  }

  return new Error(`SFTP connection to ${host}:${port} failed: ${err.message}`)
}

/**
 * Creates an SSH connection for SFTP using the provided configuration.
 * Uses ssh2 library defaults which align with OpenSSH standards.
 *
 * When `hostFingerprint` is supplied the server's host key is pinned to it and
 * a mismatch aborts the handshake before any credential is sent. Without it
 * ssh2 accepts whatever host key answers, which is the pre-existing behavior
 * kept for backward compatibility.
 */
export async function createSftpConnection(config: SftpConnectionConfig): Promise<Client> {
  const host = config.host

  if (!host || host.trim() === '') {
    throw new Error('Host is required. Please provide a valid hostname or IP address.')
  }

  const hostValidation = await validateDatabaseHost(host, 'host')
  if (!hostValidation.isValid) {
    throw new Error(hostValidation.error)
  }

  const resolvedHost = hostValidation.resolvedIP ?? host.trim()

  return new Promise((resolve, reject) => {
    const client = new Client()
    const port = config.port || 22

    const hasPassword = config.password && config.password.trim() !== ''
    const hasPrivateKey = config.privateKey && config.privateKey.trim() !== ''

    if (!hasPassword && !hasPrivateKey) {
      reject(new Error('Authentication required. Please provide either a password or private key.'))
      return
    }

    const connectConfig: ConnectConfig = {
      host: resolvedHost,
      port,
      username: config.username,
    }

    if (config.readyTimeout !== undefined) {
      connectConfig.readyTimeout = config.readyTimeout
    }
    if (config.keepaliveInterval !== undefined) {
      connectConfig.keepaliveInterval = config.keepaliveInterval
    }
    if (config.timeout !== undefined) {
      connectConfig.timeout = config.timeout
    }

    const suppliedFingerprint = config.hostFingerprint?.trim()
    const expectedFingerprint = suppliedFingerprint
      ? normalizeSha256Fingerprint(suppliedFingerprint)
      : undefined

    /**
     * Fail closed rather than silently skipping verification. A value that is
     * non-blank but normalizes away (`SHA256:`, `=`) would otherwise leave no
     * `hostVerifier` installed, trusting whatever host answers — the opposite
     * of what supplying a fingerprint asks for.
     */
    if (suppliedFingerprint && !expectedFingerprint) {
      throw new Error(
        'Host key fingerprint is not a valid SHA-256 fingerprint. Expected the base64 form printed by `ssh-keyscan <host> | ssh-keygen -lf -`.'
      )
    }

    /**
     * Set when the pinned fingerprint does not match. ssh2 reports the
     * rejection through a generic `'error'` event, so the precise cause is
     * carried out of the verifier rather than re-derived from that message.
     */
    let hostKeyRejection: Error | undefined

    if (expectedFingerprint) {
      connectConfig.hostVerifier = (hostKey: Buffer): boolean => {
        const actualFingerprint = computeHostKeyFingerprint(hostKey)
        if (safeCompare(actualFingerprint, expectedFingerprint)) {
          return true
        }
        hostKeyRejection = new Error(
          `Host key verification failed for ${host}:${port}. ` +
            `Expected SHA256:${expectedFingerprint} but the server presented SHA256:${actualFingerprint}. ` +
            `Either the server's host key changed, or the connection was intercepted. ` +
            `Re-run "ssh-keyscan -t rsa,ecdsa,ed25519 ${host}" to confirm the current key before updating the fingerprint.`
        )
        logger.warn('SFTP host key fingerprint mismatch', { host, port })
        return false
      }
    }

    if (hasPrivateKey) {
      connectConfig.privateKey = config.privateKey!
      if (config.passphrase && config.passphrase.trim() !== '') {
        connectConfig.passphrase = config.passphrase
      }
    } else if (hasPassword) {
      connectConfig.password = config.password!
    }

    client.on('ready', () => {
      resolve(client)
    })

    client.on('error', (err) => {
      reject(hostKeyRejection ?? formatSftpError(err, { host, port }))
    })

    /**
     * ssh2 only re-emits the socket's `'timeout'` event; it never destroys the
     * socket, so without this the connection would sit open forever after the
     * idle timeout elapsed.
     */
    client.on('timeout', () => {
      client.destroy()
      reject(
        new Error(
          `Connection to ${host}:${port} timed out after ${config.timeout}ms of inactivity.`
        )
      )
    })

    try {
      client.connect(connectConfig)
    } catch (err) {
      reject(formatSftpError(toError(err), { host, port }))
    }
  })
}

/**
 * Gets SFTP subsystem from SSH client
 */
export function getSftp(client: Client): Promise<SFTPWrapper> {
  return new Promise((resolve, reject) => {
    client.sftp((err, sftp) => {
      if (err) {
        reject(new Error(`Failed to start SFTP session: ${err.message}`))
      } else {
        resolve(sftp)
      }
    })
  })
}

/** Maximum bytes a route will buffer from a remote SFTP file. */
export const MAX_SFTP_READ_BYTES = 50 * 1024 * 1024

/**
 * Reads a remote file into memory, enforcing the cap on the bytes actually
 * received rather than on the `stat()` size the remote server reports.
 * A caller-supplied SSH server can understate the size in its `SSH_FXP_STAT`
 * reply and then stream unbounded data, so the stream is destroyed as soon as
 * the running total exceeds `maxBytes`. Rejects with a `PayloadSizeLimitError`.
 */
export function readSftpFileCapped(
  sftp: SFTPWrapper,
  remotePath: string,
  maxBytes: number,
  label: string
): Promise<Buffer> {
  const stream = sftp.createReadStream(remotePath)

  /**
   * Closing the SSH client rejects every still-pending SFTP request with
   * "No response from server", which lands as a late `error` on a stream the
   * limiter has already detached from once it destroyed it. An `error` event
   * with no listener is an uncaught exception, so keep one attached for the
   * stream's whole life; the limiter's own handler still settles the promise.
   */
  stream.on('error', () => {})

  return readNodeStreamToBufferWithLimit(stream, { maxBytes, label })
}

/**
 * Sanitizes a remote path to prevent path traversal attacks.
 * Removes null bytes, normalizes path separators, and collapses traversal sequences.
 * Based on OWASP Path Traversal prevention guidelines.
 */
export function sanitizePath(path: string): string {
  let sanitized = path
  sanitized = sanitized.replace(/\0/g, '')
  sanitized = decodeURIComponent(sanitized)
  sanitized = sanitized.replace(/\\/g, '/')
  sanitized = sanitized.replace(/\/+/g, '/')
  sanitized = sanitized.trim()
  return sanitized
}

/**
 * Sanitizes a filename to prevent path traversal and injection attacks.
 * Removes directory traversal sequences, path separators, null bytes, and dangerous patterns.
 * Based on OWASP Input Validation Cheat Sheet recommendations.
 */
export function sanitizeFileName(fileName: string): string {
  let sanitized = fileName
  sanitized = sanitized.replace(/\0/g, '')

  try {
    sanitized = decodeURIComponent(sanitized)
  } catch {
    // Keep original if decode fails (malformed encoding)
  }

  sanitized = sanitized.replace(/\.\.[/\\]?/g, '')
  sanitized = sanitized.replace(/[/\\]/g, '_')
  sanitized = sanitized.replace(/^\.+/, '')
  sanitized = sanitized.replace(/[\x00-\x1f\x7f]/g, '')
  sanitized = sanitized.trim()

  return sanitized || 'unnamed_file'
}

/**
 * Validates that a path doesn't contain traversal sequences.
 * Returns true if the path is safe, false if it contains potential traversal attacks.
 */
export function isPathSafe(path: string): boolean {
  const normalizedPath = path.replace(/\\/g, '/')

  if (normalizedPath.includes('../') || normalizedPath.includes('..\\')) {
    return false
  }

  try {
    const decoded = decodeURIComponent(normalizedPath)
    if (decoded.includes('../') || decoded.includes('..\\')) {
      return false
    }
  } catch {
    return false
  }

  if (normalizedPath.includes('\0')) {
    return false
  }

  return true
}

/**
 * Parses file permissions from mode bits to octal string representation.
 */
export function parsePermissions(mode: number): string {
  return `0${(mode & 0o777).toString(8)}`
}

/**
 * Determines file type from SFTP attributes mode bits.
 */
export function getFileType(attrs: Attributes): 'file' | 'directory' | 'symlink' | 'other' {
  const fileType = attrs.mode & S_IFMT

  if (fileType === S_IFDIR) return 'directory'
  if (fileType === S_IFREG) return 'file'
  if (fileType === S_IFLNK) return 'symlink'
  return 'other'
}

/**
 * Checks if a path exists on the SFTP server.
 */
export function sftpExists(sftp: SFTPWrapper, path: string): Promise<boolean> {
  return new Promise((resolve) => {
    sftp.stat(path, (err) => {
      resolve(!err)
    })
  })
}

/**
 * Checks if a path is a directory on the SFTP server.
 */
export function sftpIsDirectory(sftp: SFTPWrapper, path: string): Promise<boolean> {
  return new Promise((resolve) => {
    sftp.stat(path, (err, stats) => {
      if (err) {
        resolve(false)
      } else {
        resolve(getFileType(stats) === 'directory')
      }
    })
  })
}

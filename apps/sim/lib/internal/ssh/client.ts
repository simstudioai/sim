import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type Attributes, Client, type ClientChannel, type ConnectConfig } from 'ssh2'
import { validateDatabaseHost } from '@/lib/core/security/input-validation.server'

const logger = createLogger('SSHClient')

const S_IFMT = 0o170000
const S_IFDIR = 0o040000
const S_IFREG = 0o100000
const S_IFLNK = 0o120000

export interface SSHConnectionConfig {
  host: string
  port: number
  username: string
  password?: string | null
  privateKey?: string | null
  passphrase?: string | null
  timeout?: number
  keepaliveInterval?: number
  readyTimeout?: number
}

export interface SSHCommandResult {
  stdout: string
  stderr: string
  exitCode: number
}

/** Formats SSH connection errors with actionable provider context. */
function formatSSHError(err: Error, config: { host: string; port: number }): Error {
  const errorMessage = err.message.toLowerCase()
  const host = config.host
  const port = config.port

  if (errorMessage.includes('econnrefused') || errorMessage.includes('connection refused')) {
    return new Error(
      `Connection refused to ${host}:${port}. ` +
        `Please verify: (1) SSH server is running on the target machine, ` +
        `(2) Port ${port} is correct (default SSH port is 22), ` +
        `(3) Firewall allows connections to port ${port}.`
    )
  }

  if (errorMessage.includes('econnreset') || errorMessage.includes('connection reset')) {
    return new Error(
      `Connection reset by ${host}:${port}. ` +
        `This usually means: (1) Wrong port number (SSH default is 22), ` +
        `(2) Server rejected the connection, ` +
        `(3) Network/firewall interrupted the connection. ` +
        `Verify your SSH server configuration and port number.`
    )
  }

  if (errorMessage.includes('etimedout') || errorMessage.includes('timeout')) {
    return new Error(
      `Connection timed out to ${host}:${port}. ` +
        `Please verify: (1) Host "${host}" is reachable, ` +
        `(2) No firewall is blocking the connection, ` +
        `(3) The SSH server is responding.`
    )
  }

  if (errorMessage.includes('enotfound') || errorMessage.includes('getaddrinfo')) {
    return new Error(
      `Could not resolve hostname "${host}". ` +
        `Please verify the hostname or IP address is correct.`
    )
  }

  if (errorMessage.includes('authentication') || errorMessage.includes('auth')) {
    return new Error(
      `Authentication failed for user on ${host}:${port}. ` +
        `Please verify: (1) Username is correct, ` +
        `(2) Password or private key is valid, ` +
        `(3) User has SSH access on the server.`
    )
  }

  if (
    errorMessage.includes('key') &&
    (errorMessage.includes('parse') || errorMessage.includes('invalid'))
  ) {
    return new Error(
      `Invalid private key format. ` +
        `Please ensure you're using a valid OpenSSH private key. ` +
        `The key should start with "-----BEGIN" and end with "-----END".`
    )
  }

  if (errorMessage.includes('host key') || errorMessage.includes('hostkey')) {
    return new Error(
      `Host key verification issue for ${host}. ` +
        `This may be the first connection to this server or the server's key has changed.`
    )
  }

  return new Error(`SSH connection to ${host}:${port} failed: ${err.message}`)
}

/** Opens an SSRF-validated SSH connection and cancels the handshake with the caller. */
export async function createSSHConnection(
  config: SSHConnectionConfig,
  signal?: AbortSignal
): Promise<Client> {
  signal?.throwIfAborted()
  const host = config.host

  if (!host || host.trim() === '') {
    throw new Error('Host is required. Please provide a valid hostname or IP address.')
  }

  const hostValidation = await validateDatabaseHost(host, 'host')
  signal?.throwIfAborted()
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

    if (hasPrivateKey) {
      connectConfig.privateKey = config.privateKey!
      if (config.passphrase && config.passphrase.trim() !== '') {
        connectConfig.passphrase = config.passphrase
      }
    } else if (hasPassword) {
      connectConfig.password = config.password!
    }

    let settled = false
    const cleanup = () => signal?.removeEventListener('abort', onAbort)
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      callback()
    }
    const onAbort = () => {
      const reason = signal?.reason ?? new DOMException('Aborted', 'AbortError')
      finish(() => reject(reason))
      client.destroy()
    }

    signal?.addEventListener('abort', onAbort, { once: true })

    client.on('ready', () => finish(() => resolve(client)))

    client.on('error', (err) => {
      finish(() => reject(formatSSHError(err, { host, port })))
    })

    try {
      client.connect(connectConfig)
    } catch (err) {
      finish(() => reject(formatSSHError(toError(err), { host, port })))
    }
  })
}

const MAX_OUTPUT_BYTES = 16 * 1024 * 1024

/** Executes a command while bounding stdout and stderr independently to 16 MiB. */
export function executeSSHCommand(
  client: Client,
  command: string,
  signal?: AbortSignal
): Promise<SSHCommandResult> {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    let stream: ClientChannel | undefined
    let settled = false
    const cleanup = () => signal?.removeEventListener('abort', onAbort)
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      callback()
    }
    const onAbort = () => {
      stream?.close()
      finish(() => reject(signal?.reason ?? new DOMException('Aborted', 'AbortError')))
    }

    signal?.addEventListener('abort', onAbort, { once: true })

    client.exec(command, (err, channel) => {
      if (err) {
        finish(() => reject(err))
        return
      }

      stream = channel
      if (signal?.aborted) {
        onAbort()
        return
      }

      let stdout = ''
      let stderr = ''
      let stdoutBytes = 0
      let stderrBytes = 0
      let stdoutTruncated = false
      let stderrTruncated = false

      channel.on('error', (streamError: Error) => finish(() => reject(streamError)))
      channel.on('close', (code: number) => {
        finish(() =>
          resolve({
            stdout: stdoutTruncated
              ? `${stdout.trim()}\n[output truncated: exceeded 16MB limit]`
              : stdout.trim(),
            stderr: stderrTruncated
              ? `${stderr.trim()}\n[stderr truncated: exceeded 16MB limit]`
              : stderr.trim(),
            exitCode: code ?? -1,
          })
        )
      })

      channel.on('data', (data: Buffer) => {
        const remaining = MAX_OUTPUT_BYTES - stdoutBytes
        if (remaining <= 0) {
          stdoutTruncated = true
          return
        }
        const chunk = data.subarray(0, remaining)
        stdout += chunk.toString()
        stdoutBytes += chunk.length
        if (data.length > remaining) stdoutTruncated = true
      })

      channel.stderr.on('data', (data: Buffer) => {
        const remaining = MAX_OUTPUT_BYTES - stderrBytes
        if (remaining <= 0) {
          stderrTruncated = true
          return
        }
        const chunk = data.subarray(0, remaining)
        stderr += chunk.toString()
        stderrBytes += chunk.length
        if (data.length > remaining) stderrTruncated = true
      })
    })
  })
}

/** Removes unsafe control bytes while preserving intentional shell syntax. */
export function sanitizeCommand(command: string): string {
  let sanitized = command.replace(/\0/g, '')

  sanitized = sanitized.replace(/[\x0B\x0C]/g, '')

  sanitized = sanitized.trim()

  const dangerousPatterns = [
    { pattern: /\$\(.*\)/, name: 'command substitution $()' },
    { pattern: /`.*`/, name: 'backtick command substitution' },
    { pattern: /;\s*rm\s+-rf/i, name: 'destructive rm -rf command' },
    { pattern: /;\s*dd\s+/i, name: 'dd command (disk operations)' },
    { pattern: /mkfs/i, name: 'filesystem formatting command' },
    { pattern: />\s*\/dev\/sd[a-z]/i, name: 'direct disk write' },
  ]

  for (const { pattern, name } of dangerousPatterns) {
    if (pattern.test(sanitized)) {
      logger.warn(`Command contains ${name}`, {
        command: sanitized.substring(0, 100) + (sanitized.length > 100 ? '...' : ''),
      })
    }
  }

  return sanitized
}

/** Removes invalid control bytes and rejects encoded or literal path traversal. */
export function sanitizePath(path: string): string {
  let sanitized = path.replace(/\0/g, '')
  sanitized = sanitized.trim()

  if (sanitized.includes('%00')) {
    logger.warn('Path contains URL-encoded null bytes', {
      path: path.substring(0, 100),
    })
    throw new Error('Path contains invalid characters')
  }

  const pathTraversalPatterns = [
    '../',
    '..\\',
    '/../',
    '\\..\\',
    '%2e%2e%2f',
    '%2e%2e/',
    '%2e%2e%5c',
    '%2e%2e\\',
    '..%2f',
    '..%5c',
    '%252e%252e',
    '..%252f',
    '..%255c',
  ]

  const lowerPath = sanitized.toLowerCase()
  for (const pattern of pathTraversalPatterns) {
    if (lowerPath.includes(pattern.toLowerCase())) {
      logger.warn('Path traversal attempt detected', {
        pattern,
        path: path.substring(0, 100),
      })
      throw new Error('Path contains invalid path traversal sequences')
    }
  }

  const segments = sanitized.split(/[/\\]/)
  for (const segment of segments) {
    if (segment === '..') {
      logger.warn('Path traversal attempt detected (.. as path segment)', {
        path: path.substring(0, 100),
      })
      throw new Error('Path contains invalid path traversal sequences')
    }
  }

  return sanitized
}

/** Escapes a value for interpolation inside a single-quoted shell argument. */
export function escapeShellArg(arg: string): string {
  return arg.replace(/'/g, "'\\''")
}

/** Formats POSIX permission bits as an octal string. */
export function parsePermissions(mode: number): string {
  return `0${(mode & 0o777).toString(8)}`
}

/** Maps POSIX mode bits to the tool's stable file-type vocabulary. */
export function getFileType(attrs: Attributes): 'file' | 'directory' | 'symlink' | 'other' {
  const mode = attrs.mode
  const fileType = mode & S_IFMT

  if (fileType === S_IFDIR) return 'directory'
  if (fileType === S_IFREG) return 'file'
  if (fileType === S_IFLNK) return 'symlink'
  return 'other'
}

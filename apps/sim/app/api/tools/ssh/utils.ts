import { createLogger } from '@sim/logger'
import { type Attributes, Client, type ConnectConfig } from 'ssh2'

const logger = createLogger('SSHUtils')

// File type constants from POSIX
const S_IFMT = 0o170000 // bit mask for the file type bit field
const S_IFDIR = 0o040000 // directory
const S_IFREG = 0o100000 // regular file
const S_IFLNK = 0o120000 // symbolic link

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

/**
 * Format SSH error with helpful troubleshooting context
 */
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

/**
 * Create an SSH connection using the provided configuration
 *
 * Uses ssh2 library defaults which align with OpenSSH standards:
 * - readyTimeout: 20000ms (20 seconds)
 * - keepaliveInterval: 0 (disabled, same as OpenSSH ServerAliveInterval)
 * - keepaliveCountMax: 3 (same as OpenSSH ServerAliveCountMax)
 */
export function createSSHConnection(config: SSHConnectionConfig): Promise<Client> {
  return new Promise((resolve, reject) => {
    const client = new Client()
    const port = config.port || 22
    const host = config.host

    if (!host || host.trim() === '') {
      reject(new Error('Host is required. Please provide a valid hostname or IP address.'))
      return
    }

    const hasPassword = config.password && config.password.trim() !== ''
    const hasPrivateKey = config.privateKey && config.privateKey.trim() !== ''

    if (!hasPassword && !hasPrivateKey) {
      reject(new Error('Authentication required. Please provide either a password or private key.'))
      return
    }

    const connectConfig: ConnectConfig = {
      host: host.trim(),
      port,
      username: config.username,
    }

    if (config.readyTimeout !== undefined) {
      connectConfig.readyTimeout = config.readyTimeout
    }
    if (config.keepaliveInterval !== undefined) {
      connectConfig.keepaliveInterval = config.keepaliveInterval
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
      reject(formatSSHError(err, { host, port }))
    })

    try {
      client.connect(connectConfig)
    } catch (err) {
      reject(formatSSHError(err instanceof Error ? err : new Error(String(err)), { host, port }))
    }
  })
}

/**
 * Execute a command on the SSH connection
 */
export function executeSSHCommand(client: Client, command: string): Promise<SSHCommandResult> {
  return new Promise((resolve, reject) => {
    client.exec(command, (err, stream) => {
      if (err) {
        reject(err)
        return
      }

      let stdout = ''
      let stderr = ''

      stream.on('close', (code: number) => {
        resolve({
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: code ?? 0,
        })
      })

      stream.on('data', (data: Buffer) => {
        stdout += data.toString()
      })

      stream.stderr.on('data', (data: Buffer) => {
        stderr += data.toString()
      })
    })
  })
}

/**
 * Sanitize command input to prevent command injection
 *
 * Removes null bytes and other dangerous control characters while preserving
 * legitimate shell syntax. Logs warnings for potentially dangerous patterns.
 *
 * Note: This function does not block complex shell commands (pipes, redirects, etc.)
 * as users legitimately need these features for remote command execution.
 *
 * @param command - The command to sanitize
 * @returns The sanitized command string
 *
 * @example
 * ```typescript
 * const safeCommand = sanitizeCommand(userInput)
 * // Use safeCommand for SSH execution
 * ```
 */
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

/**
 * Sanitize and validate file path to prevent path traversal attacks
 *
 * This function validates that a file path does not contain:
 * - Null bytes
 * - Path traversal sequences (.. or ../)
 * - URL-encoded path traversal attempts
 *
 * @param path - The file path to sanitize and validate
 * @returns The sanitized path if valid
 * @throws Error if path traversal is detected
 *
 * @example
 * ```typescript
 * try {
 *   const safePath = sanitizePath(userInput)
 *   // Use safePath safely
 * } catch (error) {
 *   // Handle invalid path
 * }
 * ```
 */
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
    '../', // Standard Unix path traversal
    '..\\', // Windows path traversal
    '/../', // Mid-path traversal
    '\\..\\', // Windows mid-path traversal
    '%2e%2e%2f', // Fully encoded ../
    '%2e%2e/', // Partially encoded ../
    '%2e%2e%5c', // Fully encoded ..\
    '%2e%2e\\', // Partially encoded ..\
    '..%2f', // .. with encoded /
    '..%5c', // .. with encoded \
    '%252e%252e', // Double URL encoded ..
    '..%252f', // .. with double encoded /
    '..%255c', // .. with double encoded \
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

/**
 * Escape a string for safe use in single-quoted shell arguments
 * This is standard practice for shell command construction.
 * e.g., "/tmp/test'file" becomes "/tmp/test'\''file"
 *
 * The pattern 'foo'\''bar' works because:
 * - First ' ends the current single-quoted string
 * - \' inserts a literal single quote (escaped outside quotes)
 * - Next ' starts a new single-quoted string
 */
export function escapeShellArg(arg: string): string {
  return arg.replace(/'/g, "'\\''")
}

/**
 * Validate that authentication credentials are provided
 */
export function validateAuth(params: { password?: string; privateKey?: string }): {
  isValid: boolean
  error?: string
} {
  if (!params.password && !params.privateKey) {
    return {
      isValid: false,
      error: 'Either password or privateKey must be provided for authentication',
    }
  }
  return { isValid: true }
}

/**
 * Parse file permissions from octal string
 */
export function parsePermissions(mode: number): string {
  return `0${(mode & 0o777).toString(8)}`
}

/**
 * Get file type from attributes mode bits
 */
export function getFileType(attrs: Attributes): 'file' | 'directory' | 'symlink' | 'other' {
  const mode = attrs.mode
  const fileType = mode & S_IFMT

  if (fileType === S_IFDIR) return 'directory'
  if (fileType === S_IFREG) return 'file'
  if (fileType === S_IFLNK) return 'symlink'
  return 'other'
}

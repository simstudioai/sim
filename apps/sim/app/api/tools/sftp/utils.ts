import { type Attributes, Client, type ConnectConfig, type SFTPWrapper } from 'ssh2'

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
 */
export function createSftpConnection(config: SftpConnectionConfig): Promise<Client> {
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
      reject(formatSftpError(err, { host, port }))
    })

    try {
      client.connect(connectConfig)
    } catch (err) {
      reject(formatSftpError(err instanceof Error ? err : new Error(String(err)), { host, port }))
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

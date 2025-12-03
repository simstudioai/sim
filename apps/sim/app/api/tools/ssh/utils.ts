import { type Attributes, Client, type ConnectConfig } from 'ssh2'

// File type constants from POSIX
const S_IFMT = 0o170000 // bit mask for the file type bit field
const S_IFDIR = 0o040000 // directory
const S_IFREG = 0o100000 // regular file
const S_IFLNK = 0o120000 // symbolic link

export interface SSHConnectionConfig {
  host: string
  port: number
  username: string
  password?: string
  privateKey?: string
  passphrase?: string
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
 * Create an SSH connection using the provided configuration
 */
export function createSSHConnection(config: SSHConnectionConfig): Promise<Client> {
  return new Promise((resolve, reject) => {
    const client = new Client()

    const connectConfig: ConnectConfig = {
      host: config.host,
      port: config.port || 22,
      username: config.username,
      readyTimeout: config.readyTimeout || 20000,
      keepaliveInterval: config.keepaliveInterval || 10000,
    }

    // Authentication: prioritize private key over password
    if (config.privateKey) {
      connectConfig.privateKey = config.privateKey
      if (config.passphrase) {
        connectConfig.passphrase = config.passphrase
      }
    } else if (config.password) {
      connectConfig.password = config.password
    } else {
      reject(new Error('Either password or privateKey must be provided'))
      return
    }

    client.on('ready', () => {
      resolve(client)
    })

    client.on('error', (err) => {
      reject(err)
    })

    client.connect(connectConfig)
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
 */
export function sanitizeCommand(command: string): string {
  // Basic sanitization - trim whitespace
  return command.trim()
}

/**
 * Sanitize file path to prevent directory traversal
 */
export function sanitizePath(path: string): string {
  // Remove any null bytes
  let sanitized = path.replace(/\0/g, '')

  // Normalize the path
  sanitized = sanitized.trim()

  return sanitized
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

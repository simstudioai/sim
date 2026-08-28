/**
 * @vitest-environment node
 *
 * Host key verification is mandatory for this connector, so these tests drive
 * the real `createSftpConnection` — including the `hostVerifier` it builds —
 * against a fake ssh2 `Client` that presents a known host key. ssh2 itself is
 * mocked, so the fake reproduces the one contract the verifier depends on:
 * it is called with the raw host key blob during `connect`, before any
 * credential is used, and a `false` return aborts the connection.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sftpConnector } from '@/connectors/sftp/sftp'

const S_IFDIR = 0o040755
const S_IFREG = 0o100644

/**
 * Host key the fake server presents, and the fingerprint OpenSSH prints for it.
 * The expected values are written out rather than recomputed with `createHash`
 * so the test asserts against a fixed digest instead of restating the
 * production code's own formula:
 *
 *   node -e "console.log(require('crypto').createHash('sha256')
 *     .update(Buffer.from('ssh-ed25519 fake host key bytes'))
 *     .digest('base64').replace(/=+$/, ''))"
 */
const SERVER_HOST_KEY = Buffer.from('ssh-ed25519 fake host key bytes')
const SERVER_FINGERPRINT = 'vavRyluclyEjo81XjQIzVxoqZgtAY47GuKLG6j6aCGM'
const OTHER_FINGERPRINT = 'Gg8WhyW1o7SY1nxHGvP4EuvFvVCSjtSBclGk7qnas5E'

const { mockValidateDatabaseHost, clientConnects } = vi.hoisted(() => ({
  mockValidateDatabaseHost: vi.fn(),
  clientConnects: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/components/icons', () => ({ SftpIcon: () => null }))

vi.mock('@/lib/core/security/input-validation.server', () => ({
  validateDatabaseHost: mockValidateDatabaseHost,
}))

/**
 * The factory is evaluated before this module's own imports are initialized, so
 * it cannot close over an imported binding (`node:events`). The emitter is
 * therefore hand-rolled inside the factory.
 */
vi.mock('ssh2', () => {
  class FakeClient {
    private handlers: Record<string, Array<(arg?: unknown) => void>> = {}

    on(event: string, handler: (arg?: unknown) => void) {
      ;(this.handlers[event] ??= []).push(handler)
      return this
    }

    once(event: string, handler: (arg?: unknown) => void) {
      const wrapped = (arg?: unknown) => {
        this.off(event, wrapped)
        handler(arg)
      }
      return this.on(event, wrapped)
    }

    off(event: string, handler: (arg?: unknown) => void) {
      this.handlers[event] = (this.handlers[event] ?? []).filter(
        (registered) => registered !== handler
      )
      return this
    }

    private emit(event: string, arg?: unknown) {
      for (const handler of this.handlers[event] ?? []) handler(arg)
    }

    connect(config: Record<string, unknown>) {
      clientConnects.push(config)
      setImmediate(() => {
        const verifier = config.hostVerifier as ((key: Buffer) => boolean) | undefined
        if (verifier && verifier(SERVER_HOST_KEY) === false) {
          this.emit('error', new Error('Host denied (verification failed)'))
          return
        }
        this.emit('ready')
      })
      return this
    }

    sftp(cb: (err: Error | null, sftp: unknown) => void) {
      cb(null, fakeSftp)
    }

    end() {
      this.emit('close')
    }

    destroy() {
      this.emit('close')
    }
  }

  return {
    Client: FakeClient,
    utils: { sftp: { STATUS_CODE: { EOF: 1, NO_SUCH_FILE: 2 } } },
  }
})

/** Minimal SFTP subsystem: one directory holding one indexable text file. */
const fakeSftp = {
  stat(path: string, cb: (err: Error | null, attrs?: unknown) => void) {
    cb(null, { mode: S_IFDIR, size: 0, mtime: 0 })
  },
  lstat(path: string, cb: (err: Error | null, attrs?: unknown) => void) {
    cb(null, { mode: S_IFREG, size: 10, mtime: 1_700_000_000 })
  },
  opendir(path: string, cb: (err: Error | null, handle?: Buffer) => void) {
    cb(null, Buffer.from(path))
  },
  readdir(handle: Buffer, cb: (err: unknown, list?: unknown) => void) {
    const key = handle.toString()
    if (readPages.has(key)) {
      const eof = new Error('EOF') as Error & { code: number }
      eof.code = 1
      cb(eof)
      return
    }
    readPages.add(key)
    cb(null, [{ filename: 'a.txt', attrs: { mode: S_IFREG, size: 10, mtime: 1_700_000_000 } }])
  },
  close(_handle: Buffer, cb: () => void) {
    cb()
  },
}

const readPages = new Set<string>()

const SECRET = 'hunter2'

function config(overrides: Record<string, unknown> = {}) {
  return {
    host: 'sftp.example.com',
    port: 22,
    username: 'sftp-user',
    rootPath: '/home/sftp-user/docs',
    hostFingerprint: `SHA256:${SERVER_FINGERPRINT}`,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  clientConnects.length = 0
  readPages.clear()
  mockValidateDatabaseHost.mockResolvedValue({ isValid: true, resolvedIP: '93.184.216.34' })
})

describe('sftp host key fingerprint is required', () => {
  const missing: Array<[string, Record<string, unknown>]> = [
    ['absent', { hostFingerprint: undefined }],
    ['empty string', { hostFingerprint: '' }],
    ['whitespace only', { hostFingerprint: '   ' }],
    ['bare SHA256 label', { hostFingerprint: 'SHA256:' }],
    ['non-string', { hostFingerprint: null }],
  ]

  it.each(missing)('validateConfig rejects a %s fingerprint', async (_label, overrides) => {
    const result = await sftpConnector.validateConfig!(SECRET, config(overrides))

    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/Host Key Fingerprint is required|not a SHA-256 host key/)
    expect(result.error).toContain('ssh-keyscan')
    expect(clientConnects).toHaveLength(0)
  })

  it('listDocuments fails closed when a stored config has no fingerprint', async () => {
    await expect(
      sftpConnector.listDocuments(SECRET, config({ hostFingerprint: undefined }))
    ).rejects.toThrow(/Host Key Fingerprint is required/)
    expect(clientConnects).toHaveLength(0)
  })

  it('getDocument fails closed when a stored config has no fingerprint', async () => {
    await expect(
      sftpConnector.getDocument!(
        SECRET,
        config({ hostFingerprint: '' }),
        '/home/sftp-user/docs/a.txt'
      )
    ).rejects.toThrow(/Host Key Fingerprint is required/)
    expect(clientConnects).toHaveLength(0)
  })

  it('names how to obtain the fingerprint and why it matters', async () => {
    const result = await sftpConnector.validateConfig!(SECRET, config({ hostFingerprint: '' }))

    expect(result.error).toContain('ssh-keyscan -t rsa,ecdsa,ed25519 <host> | ssh-keygen -lf -')
    expect(result.error).toContain('on-path attacker')
  })

  it('rejects an MD5 fingerprint with a format-specific message', async () => {
    const result = await sftpConnector.validateConfig!(
      SECRET,
      config({ hostFingerprint: 'aa:bb:cc:dd:ee:ff:00:11:22:33:44:55:66:77:88:99' })
    )

    expect(result.valid).toBe(false)
    expect(result.error).toContain('not a SHA-256 host key fingerprint')
    expect(clientConnects).toHaveLength(0)
  })
})

describe('sftp host key verification', () => {
  it('accepts a matching fingerprint and installs a hostVerifier', async () => {
    const result = await sftpConnector.validateConfig!(SECRET, config())

    expect(result).toEqual({ valid: true })
    expect(clientConnects).toHaveLength(1)
    expect(typeof clientConnects[0].hostVerifier).toBe('function')
  })

  it('syncs with a matching fingerprint', async () => {
    const list = await sftpConnector.listDocuments(SECRET, config())

    expect(list.documents.map((d) => d.externalId)).toEqual(['/home/sftp-user/docs/a.txt'])
  })

  it('rejects a mismatched fingerprint before authenticating', async () => {
    const result = await sftpConnector.validateConfig!(
      SECRET,
      config({ hostFingerprint: `SHA256:${OTHER_FINGERPRINT}` })
    )

    expect(result.valid).toBe(false)
    expect(result.error).toContain('Host key verification failed')
    expect(result.error).toContain(SERVER_FINGERPRINT)
    expect(result.error).toContain('ssh-keyscan')
  })

  it('does not send the credential in the connect config until the key matches', async () => {
    await sftpConnector.validateConfig!(SECRET, config())

    /**
     * ssh2 runs `hostVerifier` during key exchange, before the authentication
     * request, so the password living in the connect config is only ever put on
     * the wire after the verifier returned true.
     */
    const verifier = clientConnects[0].hostVerifier as (key: Buffer) => boolean
    expect(verifier(SERVER_HOST_KEY)).toBe(true)
    expect(verifier(Buffer.from('an impostor key'))).toBe(false)
  })
})

describe('sftp fingerprint format tolerance', () => {
  const accepted: Array<[string, string]> = [
    ['with the SHA256: prefix', `SHA256:${SERVER_FINGERPRINT}`],
    ['with a lowercase sha256: prefix', `sha256:${SERVER_FINGERPRINT}`],
    ['with no prefix', SERVER_FINGERPRINT],
    ['with base64 padding', `SHA256:${SERVER_FINGERPRINT}=`],
    ['with surrounding whitespace', `  SHA256:${SERVER_FINGERPRINT}  `],
    [
      'with an embedded line wrap',
      `SHA256:${SERVER_FINGERPRINT.slice(0, 20)}\n${SERVER_FINGERPRINT.slice(20)}`,
    ],
  ]

  it.each(accepted)('accepts a fingerprint %s', async (_label, fingerprint) => {
    const result = await sftpConnector.validateConfig!(
      SECRET,
      config({ hostFingerprint: fingerprint })
    )

    expect(result).toEqual({ valid: true })
  })

  it('is case-sensitive in the base64 body, since base64 is', async () => {
    const flipped = SERVER_FINGERPRINT.split('')
      .map((c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()))
      .join('')
    if (flipped === SERVER_FINGERPRINT) return

    const result = await sftpConnector.validateConfig!(
      SECRET,
      config({ hostFingerprint: `SHA256:${flipped}` })
    )

    expect(result.valid).toBe(false)
  })
})

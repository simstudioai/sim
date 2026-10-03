import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import {
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing/mocks/input-validation.mock'
import type { ConnectConfig, SFTPWrapper } from 'ssh2'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'

const mocks = vi.hoisted(() => ({
  connectConfigs: [] as ConnectConfig[],
  clients: [] as Array<{
    emit: (event: string, value?: unknown) => void
    destroy: ReturnType<typeof vi.fn>
  }>,
  emitReady: true,
}))

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

vi.mock('ssh2', () => ({
  Client: class {
    private listeners = new Map<string, Set<(value?: unknown) => void>>()
    destroy = vi.fn(() => this.emit('close'))
    end = vi.fn(() => this.emit('close'))

    constructor() {
      mocks.clients.push(this)
    }

    on(event: string, listener: (value?: unknown) => void) {
      const listeners = this.listeners.get(event) ?? new Set()
      listeners.add(listener)
      this.listeners.set(event, listeners)
      return this
    }

    once(event: string, listener: (value?: unknown) => void) {
      const onceListener = (value?: unknown) => {
        this.off(event, onceListener)
        listener(value)
      }
      return this.on(event, onceListener)
    }

    off(event: string, listener: (value?: unknown) => void) {
      this.listeners.get(event)?.delete(listener)
      return this
    }

    emit(event: string, value?: unknown) {
      for (const listener of [...(this.listeners.get(event) ?? [])]) listener(value)
    }

    connect(config: ConnectConfig) {
      mocks.connectConfigs.push(config)
      if (mocks.emitReady) this.emit('ready')
    }
  },
}))

import {
  createSftpConnection,
  readSftpFileCapped,
  sanitizeFileName,
} from '@/lib/internal/sftp/client'

const { mockValidateDatabaseHost } = inputValidationMockFns

function fakeSftp(chunkSize: number, chunkCount: number) {
  let emitted = 0
  const stream = new Readable({
    read() {
      if (emitted >= chunkCount) {
        this.push(null)
        return
      }
      emitted++
      this.push(Buffer.alloc(chunkSize, 0x41))
    },
  })
  const createReadStream = vi.fn(() => stream)
  return { sftp: { createReadStream } as unknown as SFTPWrapper, stream, createReadStream }
}

describe('SFTP client boundary', () => {
  beforeEach(() => {
    mocks.clients.length = 0
    mocks.connectConfigs.length = 0
    mocks.emitReady = true
    mockValidateDatabaseHost.mockResolvedValue({ isValid: true, resolvedIP: '203.0.113.10' })
  })

  it('pins the connection to the validated IP while preserving credentials', async () => {
    await createSftpConnection({
      host: 'sftp.example.com',
      port: 22,
      username: 'user',
      password: 'secret',
    })

    expect(mocks.connectConfigs[0]).toMatchObject({
      host: '203.0.113.10',
      port: 22,
      username: 'user',
      password: 'secret',
    })
  })

  it('installs a SHA-256 host-key verifier and accepts the pinned key', async () => {
    const hostKey = Buffer.from('trusted-host-key')
    const fingerprint = createHash('sha256').update(hostKey).digest('base64').replace(/=+$/, '')

    await createSftpConnection({
      host: 'sftp.example.com',
      port: 22,
      username: 'user',
      password: 'secret',
      hostFingerprint: `SHA256:${fingerprint}`,
    })

    expect(mocks.connectConfigs[0].hostVerifier?.(hostKey)).toBe(true)
    expect(mocks.connectConfigs[0].hostVerifier?.(Buffer.from('other-key'))).toBe(false)
  })

  it('destroys a remote stream when actual bytes exceed the cap', async () => {
    const { sftp, stream } = fakeSftp(8, 1_000_000)
    await expect(readSftpFileCapped(sftp, '/bomb', 16, 'file')).rejects.toSatisfy(
      isPayloadSizeLimitError
    )
    expect(stream.destroyed).toBe(true)
  })

  it.each([
    ['../../secret.txt', '_.._secret.txt'],
    ['....//secret.txt', '_secret.txt'],
    ['..\\..\\secret.txt', '_.._secret.txt'],
    ['%2e%2e%2f%2e%2e%2fsecret.txt', '_.._secret.txt'],
    ['folder///nested\\file.txt', 'folder_nested_file.txt'],
  ])('keeps an untrusted upload name in one path segment', (input, expected) => {
    const sanitized = sanitizeFileName(input)

    expect(sanitized).toBe(expected)
    expect(sanitized).not.toMatch(/[/\\]/)
  })
})

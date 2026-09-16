import { Readable } from 'node:stream'
/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isInternalToolFileResult } from '@/lib/internal/tool-operations/file-result'

const mocks = vi.hoisted(() => ({
  client: { destroy: vi.fn(), end: vi.fn(), sftp: vi.fn() },
  createSSHConnection: vi.fn(),
  executeSSHCommand: vi.fn(),
}))

vi.mock('@/lib/internal/ssh/client', () => ({
  createSSHConnection: mocks.createSSHConnection,
  escapeShellArg: (value: string) => value.replace(/'/g, "'\\''"),
  executeSSHCommand: mocks.executeSSHCommand,
  getFileType: vi.fn(),
  parsePermissions: vi.fn(),
  sanitizeCommand: (value: string) => value.trim(),
  sanitizePath: (value: string) => value.trim(),
}))

import { executeSshDownloadFile, executeSshExecuteCommand } from '@/lib/internal/ssh/operations'

const INPUT = {
  host: 'ssh.example.com',
  port: 22,
  username: 'deploy',
  password: 'not-a-real-password',
  command: ' pwd ',
  workingDirectory: "/srv/app's",
}

const storedFile = {
  id: 'stored-file',
  name: 'file.txt',
  size: 5,
  type: 'text/plain',
  mimeType: 'text/plain',
  url: '/api/files/stored',
  key: 'execution/file.txt',
  context: 'execution',
} as const

describe('SSH operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createSSHConnection.mockResolvedValue(mocks.client)
    mocks.executeSSHCommand.mockResolvedValue({ stdout: '/srv/app', stderr: '', exitCode: 0 })
  })

  it('threads cancellation to connection and command while preserving command semantics', async () => {
    const controller = new AbortController()

    const result = await executeSshExecuteCommand(INPUT, { signal: controller.signal })

    expect(result).toEqual({
      stdout: '/srv/app',
      stderr: '',
      exitCode: 0,
      success: true,
      message: 'Command executed with exit code 0',
    })
    expect(mocks.createSSHConnection).toHaveBeenCalledWith(INPUT, controller.signal)
    expect(mocks.executeSSHCommand).toHaveBeenCalledWith(
      mocks.client,
      "cd '/srv/app'\\''s' && pwd",
      controller.signal
    )
    expect(mocks.client.end).toHaveBeenCalledOnce()
  })

  it.each([5, 12 * 1024 * 1024])(
    'downloads %i bytes through a stored file without inline content in v2',
    async (size) => {
      const buffer = Buffer.alloc(size, 65)
      const sftp = {
        stat: vi.fn((_path, callback) => callback(null, { size })),
        createReadStream: vi.fn(() => Readable.from([buffer])),
      }
      mocks.client.sftp.mockImplementation((callback) => callback(null, sftp))
      const result = await executeSshDownloadFile(
        {
          host: INPUT.host,
          port: INPUT.port,
          username: INPUT.username,
          password: INPUT.password,
          remotePath: '/file.txt',
        },
        {},
        'v2'
      )
      if (!isInternalToolFileResult(result)) throw new Error('Expected a file output')
      expect(result.files[0]?.buffer.length).toBe(size)
      expect(result.files[0]?.name).toBe('file.txt')
      const file = { ...storedFile, size }
      const presented = result.present([file])
      expect(presented).toEqual({
        file,
        remotePath: '/file.txt',
      })
      expect(JSON.stringify(presented)).not.toContain('"content"')
      expect(sftp.createReadStream).toHaveBeenCalledOnce()
      expect(mocks.client.end).toHaveBeenCalledOnce()
    }
  )

  it('preserves the complete legacy v1 download response', async () => {
    const buffer = Buffer.from('hello')
    const sftp = {
      stat: vi.fn((_path, callback) => callback(null, { size: buffer.length })),
      createReadStream: vi.fn(() => Readable.from([buffer])),
    }
    mocks.client.sftp.mockImplementation((callback) => callback(null, sftp))
    const result = await executeSshDownloadFile({ ...INPUT, remotePath: '/file.txt' }, {})
    expect(result).toEqual({
      downloaded: true,
      file: {
        name: 'file.txt',
        mimeType: 'text/plain',
        data: buffer.toString('base64'),
        size: 5,
      },
      content: buffer.toString('base64'),
      fileName: 'file.txt',
      remotePath: '/file.txt',
      size: 5,
      message: 'File downloaded successfully from /file.txt',
    })
  })

  it('destroys and closes the client when cancellation wins during provider work', async () => {
    const controller = new AbortController()
    mocks.executeSSHCommand.mockImplementationOnce(async () => {
      controller.abort(new DOMException('cancelled', 'AbortError'))
      return { stdout: '', stderr: '', exitCode: 0 }
    })

    await expect(
      executeSshExecuteCommand(INPUT, { signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.client.destroy).toHaveBeenCalledOnce()
    expect(mocks.client.end).toHaveBeenCalledOnce()
  })
})

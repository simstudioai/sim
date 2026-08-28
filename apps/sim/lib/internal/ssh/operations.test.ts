/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  client: { destroy: vi.fn(), end: vi.fn() },
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

import { executeSshExecuteCommand } from '@/lib/internal/ssh/operations'

const INPUT = {
  host: 'ssh.example.com',
  port: 22,
  username: 'deploy',
  password: 'not-a-real-password',
  command: ' pwd ',
  workingDirectory: "/srv/app's",
}

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

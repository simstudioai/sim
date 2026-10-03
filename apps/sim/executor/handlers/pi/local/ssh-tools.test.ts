import { describe, expect, it, vi } from 'vitest'

const { mockExecuteSSHCommand } = vi.hoisted(() => ({
  mockExecuteSSHCommand: vi.fn(),
}))

vi.mock('@/lib/internal/ssh/client', () => ({
  createSSHConnection: vi.fn(),
  executeSSHCommand: mockExecuteSSHCommand,
  escapeShellArg: (value: string) => value.replace(/'/g, "'\\''"),
  sanitizeCommand: (value: string) => value,
  sanitizePath: (value: string) => {
    if (value.split(/[/\\]/).includes('..')) {
      throw new Error('Path contains invalid path traversal sequences')
    }
    return value.trim()
  },
}))

import { buildSshToolSpecs, type PiSshSession } from '@/executor/handlers/pi/local/ssh-tools'

function createSession(files: Record<string, string>): PiSshSession {
  const sftp = {
    readFile: (path: string, cb: (err: Error | undefined, data: Buffer) => void) => {
      if (!(path in files)) {
        cb(new Error(`no such file: ${path}`), Buffer.from(''))
        return
      }
      cb(undefined, Buffer.from(files[path]))
    },
    writeFile: (path: string, data: string, cb: (err?: Error) => void) => {
      files[path] = data
      cb(undefined)
    },
  }
  return {
    client: {} as PiSshSession['client'],
    sftp: sftp as unknown as PiSshSession['sftp'],
    close: vi.fn(),
  }
}

function getTool(repoPath: string, files: Record<string, string>, name: string) {
  const tools = buildSshToolSpecs(createSession(files), repoPath)
  const tool = tools.find((t) => t.name === name)
  if (!tool) throw new Error(`tool not found: ${name}`)
  return tool
}

describe('buildSshToolSpecs', () => {
  it('runs bash scoped to the repo directory', async () => {
    mockExecuteSSHCommand.mockResolvedValue({ stdout: 'out', stderr: '', exitCode: 0 })
    const bash = getTool('/repo', {}, 'bash')
    const result = await bash.execute({ command: 'ls -la' })
    expect(result).toEqual({ text: 'out', isError: false })
    expect(mockExecuteSSHCommand).toHaveBeenCalledWith(expect.anything(), "cd '/repo' && ls -la")
  })

  it('rejects path traversal and paths outside the repo', async () => {
    const read = getTool('/repo', {}, 'read')
    expect((await read.execute({ path: '../etc/passwd' })).isError).toBe(true)
    expect((await read.execute({ path: '/outside/repo' })).isError).toBe(true)
  })
})

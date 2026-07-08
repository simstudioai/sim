/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockExecuteSSHCommand } = vi.hoisted(() => ({
  mockExecuteSSHCommand: vi.fn(),
}))

vi.mock('@/app/api/tools/ssh/utils', () => ({
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

import type { PiSshSession } from '@/executor/handlers/pi/ssh-tools'
import { buildSshToolSpecs } from '@/executor/handlers/pi/ssh-tools'

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
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reads a file resolved against repoPath', async () => {
    const read = getTool('/repo', { '/repo/a.txt': 'contents' }, 'read')
    expect(await read.execute({ path: 'a.txt' })).toEqual({ text: 'contents', isError: false })
  })

  it('writes a file resolved against repoPath', async () => {
    const files: Record<string, string> = {}
    const write = getTool('/repo', files, 'write')
    const result = await write.execute({ path: 'b.txt', content: 'hello' })
    expect(result.isError).toBe(false)
    expect(files['/repo/b.txt']).toBe('hello')
  })

  it('edits the first occurrence of old_string', async () => {
    const files = { '/repo/c.txt': 'foo bar foo' }
    const edit = getTool('/repo', files, 'edit')
    const result = await edit.execute({ path: 'c.txt', old_string: 'foo', new_string: 'baz' })
    expect(result.isError).toBe(false)
    expect(files['/repo/c.txt']).toBe('baz bar foo')
  })

  it('reports an error when old_string is absent', async () => {
    const edit = getTool('/repo', { '/repo/c.txt': 'nothing here' }, 'edit')
    const result = await edit.execute({ path: 'c.txt', old_string: 'missing', new_string: 'x' })
    expect(result.isError).toBe(true)
  })

  it('runs bash scoped to the repo directory', async () => {
    mockExecuteSSHCommand.mockResolvedValue({ stdout: 'out', stderr: '', exitCode: 0 })
    const bash = getTool('/repo', {}, 'bash')
    const result = await bash.execute({ command: 'ls -la' })
    expect(result).toEqual({ text: 'out', isError: false })
    expect(mockExecuteSSHCommand).toHaveBeenCalledWith(expect.anything(), "cd '/repo' && ls -la")
  })

  it('marks a non-zero bash exit as an error', async () => {
    mockExecuteSSHCommand.mockResolvedValue({ stdout: '', stderr: 'boom', exitCode: 2 })
    const bash = getTool('/repo', {}, 'bash')
    const result = await bash.execute({ command: 'false' })
    expect(result.isError).toBe(true)
  })

  it('rejects path traversal and paths outside the repo', async () => {
    const read = getTool('/repo', {}, 'read')
    expect((await read.execute({ path: '../etc/passwd' })).isError).toBe(true)
    expect((await read.execute({ path: '/outside/repo' })).isError).toBe(true)
  })
})

import { spawnSync } from 'node:child_process'
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  remoteSandboxProviderMock,
  remoteSandboxProviderMockFns,
} from '@sim/testing/mocks/remote-sandbox-provider.mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  find: vi.fn(),
  command: vi.fn(),
  remove: vi.fn(),
  read: vi.fn(),
  size: vi.fn(),
}))
vi.mock('@/lib/execution/remote-sandbox/provider', () => remoteSandboxProviderMock)
vi.mock('@/lib/execution/remote-sandbox/session-lock', () => ({
  withSandboxSessionLock: async (
    _key: string,
    signal: AbortSignal,
    execute: (signal: AbortSignal) => Promise<unknown>
  ) => execute(signal),
}))

import { openSessionFileSnapshot } from '@/lib/execution/remote-sandbox/session-file-snapshot'
import { fileReadFailure } from '@/lib/mothership/agent-cli/engines/file-view'

remoteSandboxProviderMockFns.mockResolveProvider.mockImplementation(() => ({
  id: 'e2b',
  findSessionSandbox: mocks.find,
}))

let directory = ''
let staged = ''
beforeEach(async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), 'scratch-snapshot-')))
  staged = join(directory, 'snapshot')
  mocks.find.mockResolvedValue({
    sandboxId: 'physical',
    runCommand: mocks.command,
    removeFile: mocks.remove,
    readFileStream: mocks.read,
    getFileSize: mocks.size,
  })
  mocks.command.mockImplementation(async (command, options) => {
    const result = spawnSync('/bin/sh', ['-c', command], {
      encoding: 'utf8',
      env: { ...process.env, ...options.envs, SIM_UPLOAD_SNAPSHOT: staged },
    })
    return { exitCode: result.status ?? 1, stdout: result.stdout, stderr: result.stderr }
  })
  mocks.size.mockImplementation(async () => (await stat(staged)).size)
  mocks.read.mockImplementation(async () => new Blob([await readFile(staged)]).stream())
  mocks.remove.mockImplementation(async () => rm(staged, { force: true }))
})
afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})
it('reads a fixed snapshot even if the original path changes before streaming', async () => {
  const path = join(directory, 'source.txt')
  await writeFile(path, 'original')
  const snapshot = await openSessionFileSnapshot('chat', path, undefined, undefined, {
    allowedRoots: [directory],
    maxBytes: 100,
  })
  await writeFile(path, 'changed')
  expect(await new Response(await snapshot.stream()).text()).toBe('original')
  await snapshot.dispose()
  expect(mocks.remove).toHaveBeenCalledOnce()
})
it('rejects symlink escape before any bytes are streamed', async () => {
  const path = join(directory, 'outside')
  await symlink('/etc/passwd', path)
  await expect(
    openSessionFileSnapshot('chat', path, undefined, undefined, {
      allowedRoots: [directory],
      maxBytes: 100,
    })
  ).rejects.toThrow('outside the permitted workbench directories')
  expect(mocks.read).not.toHaveBeenCalled()
})
it('bounds the remote copy itself, not just the eventual response stream', async () => {
  const path = join(directory, 'large')
  await writeFile(path, '123456')
  await expect(
    openSessionFileSnapshot('chat', path, undefined, undefined, {
      allowedRoots: [directory],
      maxBytes: 3,
    })
  ).rejects.toThrow('size limit')
  expect(mocks.read).not.toHaveBeenCalled()
})
it('asks the reconnect for the idle lease, which can outlast the runtime cap', async () => {
  const IDLE_MS = 20 * 60_000
  const capAtMs = Date.now() + 60_000
  let leaseEndAtMs = capAtMs
  const machine = await mocks.find()
  mocks.find.mockImplementation(async (_key: string, options: { lifetimeMs?: number }) => {
    if (options.lifetimeMs !== undefined) leaseEndAtMs = Date.now() + options.lifetimeMs
    return {
      ...machine,
      extendLifetime: async (lifetimeMs: number) => {
        leaseEndAtMs = Math.min(Date.now() + lifetimeMs, capAtMs)
      },
    }
  })
  const path = join(directory, 'source.txt')
  await writeFile(path, 'original')
  const snapshot = await openSessionFileSnapshot('chat', path, undefined, undefined, {
    allowedRoots: [directory],
    maxBytes: 100,
  })
  await snapshot.dispose()
  expect(leaseEndAtMs).toBeGreaterThanOrEqual(Date.now() + IDLE_MS - 1000)
})
it('never creates a replacement machine for a missing read', async () => {
  mocks.find.mockResolvedValue(null)
  await expect(openSessionFileSnapshot('chat', '/tmp/missing')).rejects.toThrow(
    'No workbench exists'
  )
  expect(mocks.command).not.toHaveBeenCalled()
})

describe('copy failures reach the model as their actionable cause', () => {
  const snapshot = (path: string, maxBytes = 100) =>
    openSessionFileSnapshot('chat', path, undefined, undefined, {
      allowedRoots: [directory],
      maxBytes,
    })
  const read = (path: string, maxBytes?: number) =>
    snapshot(path, maxBytes).then(
      () => {
        throw new Error('expected the snapshot to fail')
      },
      (error: unknown) => fileReadFailure(error).stderr
    )

  it('names a missing file and the race with the step that writes it', async () => {
    const path = join(directory, 'missing.csv')
    expect(await read(path)).toBe(
      `Error: No file exists at ${path} on this chat's workbench. Check the path, or wait for the step that writes it to finish.`
    )
  })
  it('names a directory as not a regular file', async () => {
    const path = join(directory, 'folder')
    await mkdir(path)
    expect(await read(path)).toContain(`${path} is not a regular file`)
  })
  /** Linux, the workbench OS, refuses to open a socket with ENXIO before any stat. */
  it.skipIf(process.platform !== 'linux')('names a socket as not a regular file', async () => {
    const path = join(directory, 'agent.sock')
    const server = createServer()
    await new Promise<void>((resolve) => server.listen(path, resolve))
    try {
      expect(await read(path)).toContain(`${path} is not a regular file`)
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  })
  it.skipIf(process.getuid?.() === 0)('names a permission failure', async () => {
    const path = join(directory, 'locked.txt')
    await writeFile(path, 'secret')
    await chmod(path, 0o000)
    expect(await read(path)).toBe(
      `Error: The workbench user does not have permission to read ${path}.`
    )
  })
  it('names the read size limit', async () => {
    const path = join(directory, 'large.txt')
    await writeFile(path, '123456')
    expect(await read(path, 3)).toBe(`Error: ${path} exceeds the 3-byte size limit.`)
  })
  it('names a path outside the permitted roots', async () => {
    const path = join(directory, 'escape')
    await symlink('/etc/passwd', path)
    expect(await read(path)).toBe(
      `Error: ${path} resolves outside the permitted workbench directories.`
    )
  })
  it.skipIf(process.getuid?.() === 0)(
    'does not blame the source for a staging file it cannot create',
    async () => {
      const path = join(directory, 'readable.txt')
      await writeFile(path, 'content')
      const locked = join(directory, 'locked')
      await mkdir(locked, { mode: 0o500 })
      staged = join(locked, 'snapshot')
      expect(await read(path)).toBe(
        'Error: The file could not be read. Retry this read before making content claims.'
      )
      await chmod(locked, 0o700)
    }
  )
  it('names a full workbench disk', async () => {
    mocks.command.mockResolvedValueOnce({
      exitCode: 3,
      stdout: 'SIM_SNAPSHOT_FAILURE no_space OSError\n',
      stderr: '',
    })
    expect(await read(join(directory, 'any.txt'))).toBe(
      "Error: This chat's workbench is out of disk space. Delete files it no longer needs, then retry."
    )
  })
  it('names a chat with no workbench', async () => {
    mocks.find.mockResolvedValueOnce(null)
    expect(await read('/tmp/out.csv')).toBe(
      'Error: No workbench exists for this chat; write "/tmp/out.csv" first.'
    )
  })
  it('keeps raw stderr out of an unclassified failure, reporting only exit code and class', async () => {
    mocks.command.mockResolvedValueOnce({
      exitCode: 3,
      stdout: 'SIM_SNAPSHOT_FAILURE unknown MemoryError\n',
      stderr: 'Traceback: /home/user/private-name.csv',
    })
    await expect(snapshot(join(directory, 'any.txt'))).rejects.toThrow(
      /^Could not prepare the workbench upload file \(exit 3, MemoryError\)$/
    )
  })
  it('gives the model the generic retry message for a copy killed without a marker', async () => {
    mocks.command.mockResolvedValueOnce({ exitCode: 137, stdout: '', stderr: 'Killed' })
    expect(await read(join(directory, 'any.txt'))).toBe(
      'Error: The file could not be read. Retry this read before making content claims.'
    )
  })
})

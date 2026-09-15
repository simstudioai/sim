/** @vitest-environment node */
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  find: vi.fn(),
  command: vi.fn(),
  remove: vi.fn(),
  read: vi.fn(),
  size: vi.fn(),
}))
vi.mock('@/lib/execution/remote-sandbox/provider', () => ({
  resolveProvider: () => ({ id: 'e2b', findSessionSandbox: mocks.find }),
}))
vi.mock('@/lib/execution/remote-sandbox/session-lock', () => ({
  withSandboxSessionLock: async (
    _key: string,
    signal: AbortSignal,
    execute: (signal: AbortSignal) => Promise<unknown>
  ) => execute(signal),
}))

import { openSessionFileSnapshot } from '@/lib/execution/remote-sandbox/session-file-snapshot'

const execute = promisify(execFile)
let directory = ''
let staged = ''
beforeEach(async () => {
  vi.clearAllMocks()
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
    try {
      const result = await execute('/bin/sh', ['-c', command], {
        env: { ...process.env, ...options.envs, SIM_UPLOAD_SNAPSHOT: staged },
      })
      return { ...result, exitCode: 0 }
    } catch (error) {
      return { exitCode: 1, stderr: error instanceof Error ? error.message : 'failed' }
    }
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
  ).rejects.toThrow('outside the permitted')
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
it('never creates a replacement machine for a missing read', async () => {
  mocks.find.mockResolvedValue(null)
  await expect(openSessionFileSnapshot('chat', '/tmp/missing')).rejects.toThrow(
    'No workbench exists'
  )
  expect(mocks.command).not.toHaveBeenCalled()
})

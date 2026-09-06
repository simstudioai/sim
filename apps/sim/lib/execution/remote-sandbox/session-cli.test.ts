/** @vitest-environment node */
import { execFile } from 'node:child_process'
import { once } from 'node:events'
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { getErrorMessage } from '@sim/utils/errors'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ensureSessionCli, sessionCommandPath } from '@/lib/execution/remote-sandbox/session-cli'
import type {
  RunCommandOptions,
  SandboxHandle,
  SandboxSessionRequest,
} from '@/lib/execution/remote-sandbox/types'

const exec = promisify(execFile)
const directories: string[] = []
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'mship-session-cli-'))
  directories.push(directory)
  const writes: string[] = []
  const commands: RunCommandOptions[] = []
  const sandbox: SandboxHandle = {
    sandboxId: 'local-filesystem',
    async writeFile(path, content) {
      writes.push(path)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, typeof content === 'string' ? content : new Uint8Array(content))
    },
    async removeFile(path) {
      await rm(path, { force: true })
    },
    async runCommand(command, options) {
      commands.push(options)
      try {
        const result = await exec('/bin/sh', ['-c', command], {
          env: { ...process.env, ...options.envs },
          signal: options.signal,
          timeout: options.timeoutMs,
        })
        return { ...result, exitCode: 0 }
      } catch (error) {
        return {
          stdout: '',
          stderr: getErrorMessage(error),
          exitCode:
            error instanceof Error && 'code' in error && typeof error.code === 'number'
              ? error.code
              : 1,
        }
      }
    },
    async runCode() {
      throw new Error('Unexpected code call')
    },
    async getFileSize(path) {
      return (await stat(path)).size
    },
    async readFile(path) {
      return readFile(path, 'utf8')
    },
    async readFileWithLimit() {
      throw new Error('Unexpected bounded read')
    },
    async listFiles() {
      throw new Error('Unexpected directory read')
    },
    async kill() {
      throw new Error('Must not kill a shared machine')
    },
  }
  const session = (
    version: string
  ): SandboxSessionRequest & { cli: { path: string; content: string } } => ({
    key: 'same-chat',
    cli: {
      path: join(directory, version, 'cli.mjs'),
      content: `#!/usr/bin/env node\nconsole.log(${JSON.stringify(version)})\n`,
    },
  })
  const environment = (value: SandboxSessionRequest) => ({
    ...process.env,
    PATH: sessionCommandPath(value, process.env.PATH ?? '/usr/bin:/bin'),
  })
  const ensure = (value: ReturnType<typeof session>, signal = new AbortController().signal) =>
    ensureSessionCli(sandbox, value.cli, signal, 10_000)
  return { directory, sandbox, session, environment, ensure, writes, commands }
}

describe('versioned workbench CLI installation', () => {
  it('runs the installed CLI and reuses complete bytes without rewriting or relinking', async () => {
    const f = await fixture()
    const session = f.session('one')
    await f.ensure(session)
    const launcher = join(dirname(session.cli.path), 'sim')
    const initial = await stat(session.cli.path)
    expect(await readlink(launcher)).toBe('cli.mjs')
    expect((await exec('sim', [], { env: f.environment(session) })).stdout.trim()).toBe('one')
    await f.ensure(session)
    expect(f.writes).toHaveLength(1)
    expect(await stat(session.cli.path)).toMatchObject({
      ino: initial.ino,
      mtimeMs: initial.mtimeMs,
      ctimeMs: initial.ctimeMs,
    })
    expect(f.commands).toHaveLength(4)
    expect(
      f.commands.every((options) => options.rootUser === false && options.atMostOnce === true)
    ).toBe(true)
    expect(await readdir(dirname(session.cli.path))).toEqual(['cli.mjs', 'sim'])
  })

  it('keeps a running script on its CLI release while a new release enters the same workbench', async () => {
    const f = await fixture()
    const oldSession = f.session('one')
    const newSession = f.session('two')
    await f.ensure(oldSession)
    const running = exec('/bin/sh', ['-c', 'sim; read next; sim'], {
      env: f.environment(oldSession),
      timeout: 10_000,
    })
    void running.catch(() => {})
    if (!running.child.stdout || !running.child.stdin) throw new Error('Missing process streams')
    try {
      await once(running.child.stdout, 'data')
      await f.ensure(newSession)
      expect((await exec('sim', [], { env: f.environment(newSession) })).stdout.trim()).toBe('two')
      running.child.stdin.end('continue\n')
      expect((await running).stdout.trim().split('\n')).toEqual(['one', 'one'])
    } finally {
      running.child.kill()
      await running.catch(() => {})
    }
  })

  it('repairs corrupt bytes and permissions without following a replaced artifact symlink', async () => {
    const f = await fixture()
    const session = f.session('one')
    await f.ensure(session)
    await writeFile(session.cli.path, 'damaged')
    await f.ensure(session)
    expect(await readFile(session.cli.path, 'utf8')).toBe(session.cli.content)
    await chmod(session.cli.path, 0o644)
    await f.ensure(session)
    expect((await stat(session.cli.path)).mode & 0o777).toBe(0o755)
    const userFile = join(f.directory, 'user-file.mjs')
    await writeFile(userFile, 'keep this')
    await rm(session.cli.path)
    await symlink(userFile, session.cli.path)
    await f.ensure(session)
    expect(await readFile(userFile, 'utf8')).toBe('keep this')
    expect((await exec('sim', [], { env: f.environment(session) })).stdout.trim()).toBe('one')
  })

  it('cleans an interrupted transfer and repairs it before a later execution', async () => {
    const f = await fixture()
    const session = f.session('one')
    const write = f.sandbox.writeFile.bind(f.sandbox)
    f.sandbox.writeFile = vi
      .fn()
      .mockImplementationOnce(async (path, content) => {
        await write(path, content)
        throw new Error('Upload acknowledgement lost')
      })
      .mockImplementation(write)
    await expect(f.ensure(session)).rejects.toThrow('Upload acknowledgement lost')
    expect(await readdir(dirname(session.cli.path))).toEqual([])
    await f.ensure(session)
    expect((await exec('sim', [], { env: f.environment(session) })).stdout.trim()).toBe('one')
  })

  it('propagates a verification outage without overwriting an unverified artifact', async () => {
    const f = await fixture()
    f.sandbox.runCommand = vi.fn().mockRejectedValue(new Error('Provider unavailable'))
    await expect(f.ensure(f.session('one'))).rejects.toThrow('Provider unavailable')
    expect(f.writes).toEqual([])
  })

  it('cleans staged CLI bytes if Stop arrives before publication', async () => {
    const f = await fixture()
    const session = f.session('one')
    const controller = new AbortController()
    const write = f.sandbox.writeFile.bind(f.sandbox)
    f.sandbox.writeFile = async (path, content) => {
      await write(path, content)
      controller.abort(new Error('Stopped'))
    }
    await expect(f.ensure(session, controller.signal)).rejects.toThrow('Stopped')
    expect(await readdir(dirname(session.cli.path))).toEqual([])
  })
})

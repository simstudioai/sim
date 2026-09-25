import { runPush } from '@sim/db/scripts/push'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/logger', () => ({ createLogger: () => ({ info: vi.fn(), error: vi.fn() }) }))

interface SpawnOptions {
  env?: NodeJS.ProcessEnv
  stdin: string
  stdout: string
  stderr: string
}

const spawn = vi.fn<(command: string[], options: SpawnOptions) => { exited: Promise<number> }>()
const stdinTty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
const stdoutTty = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')

function setTerminal(enabled: boolean) {
  Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: enabled })
  Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: enabled })
}

beforeEach(() => {
  spawn.mockReset().mockImplementation(() => ({ exited: Promise.resolve(0) }))
  vi.stubGlobal('Bun', { spawn })
  setTerminal(false)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  if (stdinTty) Object.defineProperty(process.stdin, 'isTTY', stdinTty)
  else Reflect.deleteProperty(process.stdin, 'isTTY')
  if (stdoutTty) Object.defineProperty(process.stdout, 'isTTY', stdoutTty)
  else Reflect.deleteProperty(process.stdout, 'isTTY')
})

describe('db:push policy and process boundaries', () => {
  it('sets create/drop only on the Drizzle child and forwards force independently', async () => {
    vi.stubEnv('SIM_DB_PUSH_RENAME_MODE', undefined)
    expect(await runPush(['--force'])).toBe(0)
    expect(spawn).toHaveBeenCalledTimes(8)
    expect(spawn.mock.calls[0][0]).toContain('./scripts/prepare-push.ts')
    expect(spawn.mock.calls[1][0]).toEqual([
      'bunx',
      '--no-install',
      'drizzle-kit',
      'push',
      '--config=./drizzle.config.ts',
      '--force',
    ])
    expect(spawn.mock.calls[1][1].env?.SIM_DB_PUSH_RENAME_MODE).toBe('create')
    expect(process.env.SIM_DB_PUSH_RENAME_MODE).toBeUndefined()
    for (const [, options] of [spawn.mock.calls[0], ...spawn.mock.calls.slice(2)])
      expect(options.env).toBeUndefined()
  })

  it('does not start Drizzle when compatibility preparation fails', async () => {
    spawn.mockReturnValueOnce({ exited: Promise.resolve(44) })
    expect(await runPush(['--force'])).toBe(44)
    expect(spawn).toHaveBeenCalledTimes(1)
  })

  it('rebuilds projections after a schema push', async () => {
    expect(await runPush([])).toBe(0)
    expect(spawn.mock.calls.slice(-3).map(([command]) => command.at(-1))).toEqual([
      './script-migrations/0019_tin_keyword_projection.ts',
      './script-migrations/0021_embedding_search_connector.ts',
      './script-migrations/0024_knowledge_projection_async.ts',
    ])
  })

  it('does not implicitly approve data loss', async () => {
    expect(await runPush([])).toBe(0)
    expect(spawn.mock.calls[0][0]).not.toContain('--force')
  })

  it('stops reconciliation when Drizzle fails', async () => {
    spawn.mockReturnValueOnce({ exited: Promise.resolve(0) })
    spawn.mockReturnValueOnce({ exited: Promise.resolve(42) })
    expect(await runPush(['--force'])).toBe(42)
    expect(spawn).toHaveBeenCalledTimes(2)
  })

  it('stops after the first failed reconciliation', async () => {
    spawn.mockReturnValueOnce({ exited: Promise.resolve(0) })
    spawn.mockReturnValueOnce({ exited: Promise.resolve(43) })
    expect(await runPush([])).toBe(43)
    expect(spawn).toHaveBeenCalledTimes(2)
  })

  it('passes intentional renames to the native chooser in a terminal', async () => {
    setTerminal(true)
    vi.stubEnv('SIM_DB_PUSH_RENAME_MODE', 'create')
    expect(await runPush(['--interactive-renames', '--verbose'])).toBe(0)
    expect(spawn.mock.calls[0][0]).not.toContain('--interactive-renames')
    expect(spawn.mock.calls[0][0]).toContain('--verbose')
    expect(spawn.mock.calls[0][1].env?.SIM_DB_PUSH_RENAME_MODE).toBe('prompt')
  })

  it('rejects interactive renames without a terminal before any database commands', async () => {
    expect(await runPush(['--interactive-renames', '--force'])).toBe(1)
    expect(spawn).not.toHaveBeenCalled()
  })

  it('does not reconcile the database when requesting help', async () => {
    expect(await runPush(['--help'])).toBe(0)
    expect(spawn).toHaveBeenCalledTimes(1)
  })
})

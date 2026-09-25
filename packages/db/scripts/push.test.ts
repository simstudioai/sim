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
  it('does not implicitly approve data loss', async () => {
    expect(await runPush([])).toBe(0)
    expect(spawn.mock.calls[0][0]).not.toContain('--force')
  })

  it('rejects interactive renames without a terminal before any database commands', async () => {
    expect(await runPush(['--interactive-renames', '--force'])).toBe(1)
    expect(spawn).not.toHaveBeenCalled()
  })
})

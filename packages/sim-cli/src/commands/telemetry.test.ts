import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readTelemetryState } from '../telemetry/index'
import { telemetryCommand } from './telemetry'

let dir: string
let output: string[]

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sim-telemetry-'))
  vi.stubEnv('SIM_CONFIG_DIR', dir)
  output = []
  vi.spyOn(console, 'log').mockImplementation((line: string) => {
    output.push(line)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  rmSync(dir, { recursive: true, force: true })
})

function run(...args: string[]): Promise<Command> {
  const root = new Command('sim').exitOverride()
  root.addCommand(telemetryCommand())
  return root.parseAsync(['node', 'sim', 'telemetry', ...args])
}

describe('sim telemetry', () => {
  it('saves the disable setting and reports the state', async () => {
    await run('disable')

    expect(readTelemetryState(join(dir, 'telemetry.json'))?.enabled).toBe(false)
    expect(output[0]).toMatch(/off/)
    expect(output[0]).toContain('sim telemetry enable')
  })

  it('reports the environment override rather than the saved setting', async () => {
    vi.stubEnv('DO_NOT_TRACK', '1')

    await run('enable')

    expect(readTelemetryState(join(dir, 'telemetry.json'))?.enabled).toBe(true)
    expect(output[0]).toContain('DO_NOT_TRACK')
  })

  it('names a build without a destination', async () => {
    await run('status')

    expect(output[0]).toMatch(/off: this build has no reporting destination/)
    expect(output[1]).toContain('https://docs.sim.ai/cli/usage-data')
  })
})

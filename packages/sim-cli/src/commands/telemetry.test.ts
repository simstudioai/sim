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
  /** Pinned so the result never depends on the shell or CI job running the suite. */
  vi.stubEnv('SIM_CLI_TELEMETRY_KEY', '')
  vi.stubEnv('DO_NOT_TRACK', '')
  vi.stubEnv('SIM_TELEMETRY_DISABLED', '')
  output = []
  vi.spyOn(console, 'log').mockImplementation((line: string) => {
    output.push(line)
  })
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function run(...args: string[]): Promise<Command> {
  const root = new Command('sim').exitOverride()
  root.addCommand(telemetryCommand())
  return root.parseAsync(['node', 'sim', 'telemetry', ...args])
}

describe('sim telemetry', () => {
  it('reports the environment override rather than the saved setting', async () => {
    vi.stubEnv('DO_NOT_TRACK', '1')

    await run('enable')

    expect(readTelemetryState(join(dir, 'telemetry.json'))?.enabled).toBe(true)
    expect(output[0]).toContain('DO_NOT_TRACK')
  })
})

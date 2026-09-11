import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CLI_VERSION } from '../version'
import { clientInfoHeader } from './client-info'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sim-client-info-'))
  vi.stubEnv('SIM_CONFIG_DIR', dir)
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(dir, { recursive: true, force: true })
})

describe('clientInfoHeader', () => {
  it('names the CLI, its runtime, the platform, and the driving agent', () => {
    expect(clientInfoHeader({ CLAUDECODE: '1' })).toBe(
      `cli/${CLI_VERSION}; node/${process.versions.node}; os/${process.platform}; arch/${process.arch}; agent/claude-code`
    )
  })

  it('withholds the agent when usage reporting is opted out', () => {
    const header = clientInfoHeader({ CLAUDECODE: '1', DO_NOT_TRACK: '1' })
    expect(header).not.toContain('agent/')
    expect(header).toContain(`cli/${CLI_VERSION}`)
  })
})

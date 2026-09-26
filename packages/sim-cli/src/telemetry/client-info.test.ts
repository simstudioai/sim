import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cliVersion } from '#sim-cli/version'
import { clientInfoHeader } from './client-info'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sim-client-info-'))
  vi.stubEnv('SIM_CONFIG_DIR', dir)
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('clientInfoHeader', () => {
  it('withholds the agent when usage reporting is opted out', () => {
    const header = clientInfoHeader({ CLAUDECODE: '1', DO_NOT_TRACK: '1' })
    expect(header).not.toContain('agent/')
    expect(header).toContain(`cli/${cliVersion()}`)
  })
})

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ensureProductionComposeFile } from './compose-asset'
import { composeInstallFromDirectory, composeServiceState } from './lifecycle'

describe('setup lifecycle', () => {
  it('does not duplicate a running install restored from its directory', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sim-setup-lifecycle-'))
    try {
      const file = ensureProductionComposeFile({ kind: 'standalone', root, existing: false })
      const active = [{ kind: 'compose', file, dir: root, project: 'sim-live' }] as const

      expect(composeInstallFromDirectory(root, active)).toBeNull()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('reads a Compose service as running when any replica is running', () => {
    expect(composeServiceState('running')).toEqual({ state: 'running' })
    expect(composeServiceState('exited\nrunning\n')).toEqual({ state: 'running' })
  })

  it('reads a Compose service with only stopped containers as stopped', () => {
    expect(composeServiceState('exited')).toEqual({ state: 'stopped' })
    expect(composeServiceState('created\nexited')).toEqual({ state: 'stopped' })
  })

  it('reads a missing Compose service or failed probe as absent', () => {
    expect(composeServiceState('')).toBeNull()
    expect(composeServiceState('\n  \n')).toBeNull()
    expect(composeServiceState(null)).toBeNull()
  })
})

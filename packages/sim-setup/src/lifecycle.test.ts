import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ensureProductionComposeFile } from './compose-asset'
import {
  composeInstallFromDirectory,
  getComposeUpdateMode,
  isLifecycleCommand,
  refreshComposeFileForUpdate,
} from './lifecycle'

describe('setup lifecycle', () => {
  it('recognizes update as a lifecycle command', () => {
    expect(isLifecycleCommand('update')).toBe(true)
  })

  it('pulls published installs and rebuilds source installs', () => {
    expect(getComposeUpdateMode('/repo/docker-compose.prod.yml')).toBe('pull')
    expect(getComposeUpdateMode('/repo/docker-compose.local.yml')).toBe('build')
    expect(() => getComposeUpdateMode('/repo/compose.yml')).toThrow(/Unsupported Sim Compose file/)
  })

  it('refreshes a discovered standalone install outside the current setup context', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sim-setup-lifecycle-'))
    try {
      const composeFile = ensureProductionComposeFile({ kind: 'standalone', root, existing: false })
      const packaged = readFileSync(composeFile, 'utf8')
      const previous = `${packaged}\nservices: {}\n`
      writeFileSync(composeFile, previous)
      writeFileSync(
        path.join(root, '.sim-setup.json'),
        JSON.stringify({
          schemaVersion: 1,
          composeSha256: createHash('sha256').update(previous).digest('hex'),
        })
      )

      expect(refreshComposeFileForUpdate(composeFile, root)).toBe(composeFile)
      expect(readFileSync(composeFile, 'utf8')).toBe(packaged)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('restores a downed standalone install from its persisted project name', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sim-setup-lifecycle-'))
    try {
      ensureProductionComposeFile({ kind: 'standalone', root, existing: false })
      writeFileSync(path.join(root, '.env'), 'COMPOSE_PROJECT_NAME=sim-a1b2c3d4e5f6\n')

      expect(composeInstallFromDirectory(root, [])).toEqual({
        kind: 'compose',
        file: path.join(root, 'docker-compose.prod.yml'),
        dir: root,
        project: 'sim-a1b2c3d4e5f6',
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

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
})

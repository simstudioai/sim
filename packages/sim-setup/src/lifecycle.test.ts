import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ensureProductionComposeFile } from './compose-asset'
import { getComposeUpdateMode, isLifecycleCommand, refreshComposeFileForUpdate } from './lifecycle'

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
})

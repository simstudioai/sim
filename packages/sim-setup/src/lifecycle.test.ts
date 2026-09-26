import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ensureProductionComposeFile } from './compose-asset'
import { composeInstallFromDirectory } from './lifecycle'

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
})

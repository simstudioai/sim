import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ensureProductionComposeFile } from './compose-asset'

const roots: string[] = []

function tempRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'sim-setup-compose-'))
  roots.push(root)
  return root
}

function standaloneContext(root: string) {
  return { kind: 'standalone', root, existing: false } as const
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('ensureProductionComposeFile', () => {
  it('fails instead of overwriting local Compose changes', () => {
    const root = tempRoot()
    const composeFile = ensureProductionComposeFile(standaloneContext(root))
    writeFileSync(composeFile, `${readFileSync(composeFile, 'utf8')}\n# local change\n`)

    expect(() => ensureProductionComposeFile({ kind: 'standalone', root, existing: true })).toThrow(
      'has local changes'
    )
  })
})

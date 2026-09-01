import { createHash } from 'node:crypto'
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
  it('materializes the packaged production Compose file and managed state', () => {
    const root = tempRoot()

    const composeFile = ensureProductionComposeFile(standaloneContext(root))

    expect(readFileSync(composeFile, 'utf8')).toContain('ghcr.io/simstudioai/simstudio')
    expect(JSON.parse(readFileSync(path.join(root, '.sim-setup.json'), 'utf8'))).toMatchObject({
      schemaVersion: 1,
      composeSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    })
  })

  it('updates a previously managed Compose file', () => {
    const root = tempRoot()
    const composeFile = ensureProductionComposeFile(standaloneContext(root))
    const previous = `${readFileSync(composeFile, 'utf8')}\nservices: {}\n`
    writeFileSync(composeFile, previous)
    writeFileSync(
      path.join(root, '.sim-setup.json'),
      JSON.stringify({
        schemaVersion: 1,
        composeSha256: createHash('sha256').update(previous).digest('hex'),
      })
    )

    ensureProductionComposeFile({ kind: 'standalone', root, existing: true })

    expect(readFileSync(composeFile, 'utf8')).not.toBe(previous)
  })

  it('fails instead of overwriting local Compose changes', () => {
    const root = tempRoot()
    const composeFile = ensureProductionComposeFile(standaloneContext(root))
    writeFileSync(composeFile, `${readFileSync(composeFile, 'utf8')}\n# local change\n`)

    expect(() => ensureProductionComposeFile({ kind: 'standalone', root, existing: true })).toThrow(
      'has local changes'
    )
  })

  it('fails on an unrelated Compose file', () => {
    const root = tempRoot()
    writeFileSync(path.join(root, 'docker-compose.prod.yml'), 'services: {}\n')

    expect(() => ensureProductionComposeFile(standaloneContext(root))).toThrow(
      'is not a recognized Sim Compose file'
    )
  })
})

import {
  chmodSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { writeTextFileAtomic } from './atomic-file'

const roots: string[] = []

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'sim-setup-atomic-file-'))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('writeTextFileAtomic', () => {
  it('replaces the complete file with the requested permissions and no staged residue', () => {
    const root = temporaryRoot()
    const file = path.join(root, '.env')
    writeFileSync(file, 'OLD=value\n')
    chmodSync(file, 0o644)

    writeTextFileAtomic(file, 'SECRET=current\n', { mode: 0o600 })

    expect(readFileSync(file, 'utf8')).toBe('SECRET=current\n')
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(readdirSync(root)).toEqual(['.env'])
  })
})

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveSetupContext } from './context'

const roots: string[] = []

function tempRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'sim-setup-context-'))
  roots.push(root)
  return root
}

function writePackage(root: string, relativePath: string, name: string): void {
  const file = path.join(root, relativePath)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({ name }))
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('resolveSetupContext', () => {
  it('finds a Sim checkout from a nested directory', () => {
    const root = tempRoot()
    writePackage(root, 'package.json', 'simstudio')
    writePackage(root, 'apps/sim/package.json', '@sim/app')
    writePackage(root, 'apps/realtime/package.json', '@sim/realtime')
    writePackage(root, 'packages/db/package.json', '@sim/db')
    const nested = path.join(root, 'apps/sim/lib')
    mkdirSync(nested, { recursive: true })

    expect(resolveSetupContext(nested, [])).toEqual({ kind: 'source', root })
  })

  it('finds an existing standalone installation', () => {
    const root = tempRoot()
    writeFileSync(
      path.join(root, 'docker-compose.prod.yml'),
      'image: ghcr.io/simstudioai/simstudio:latest\n'
    )

    expect(resolveSetupContext(root, [])).toEqual({ kind: 'standalone', root, existing: true })
  })

  it('creates a dedicated child directory outside an installation', () => {
    const root = tempRoot()

    expect(resolveSetupContext(root, [])).toEqual({
      kind: 'standalone',
      root: path.join(root, 'sim'),
      existing: false,
    })
  })

  it('finds an existing installation in the default child directory', () => {
    const root = tempRoot()
    const installRoot = path.join(root, 'sim')
    mkdirSync(installRoot)
    writeFileSync(
      path.join(installRoot, 'docker-compose.prod.yml'),
      'image: ghcr.io/simstudioai/simstudio:latest\n'
    )

    expect(resolveSetupContext(root, [])).toEqual({
      kind: 'standalone',
      root: installRoot,
      existing: true,
    })
  })

  it('fails on a partial Sim checkout', () => {
    const root = tempRoot()
    writePackage(root, 'package.json', 'simstudio')
    writePackage(root, 'apps/sim/package.json', '@sim/app')

    expect(() => resolveSetupContext(root, [])).toThrow('Incomplete Sim source checkout')
  })

  it('fails on malformed package metadata instead of ignoring it', () => {
    const root = tempRoot()
    writeFileSync(path.join(root, 'package.json'), '{')

    expect(() => resolveSetupContext(root, [])).toThrow(SyntaxError)
  })

  it('honors an explicit installation directory', () => {
    const root = tempRoot()

    expect(resolveSetupContext(root, ['--dir', 'custom'])).toEqual({
      kind: 'standalone',
      root: path.join(root, 'custom'),
      existing: false,
    })
  })

  it('does not replace an explicit standalone directory with an ancestor checkout', () => {
    const root = tempRoot()
    writePackage(root, 'package.json', 'simstudio')
    writePackage(root, 'apps/sim/package.json', '@sim/app')
    writePackage(root, 'apps/realtime/package.json', '@sim/realtime')
    writePackage(root, 'packages/db/package.json', '@sim/db')

    expect(resolveSetupContext(root, ['--dir', 'deployment'])).toEqual({
      kind: 'standalone',
      root: path.join(root, 'deployment'),
      existing: false,
    })
  })
})

/** @vitest-environment node */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readBlockRegistryAtRef } from '@/scripts/block-registry-snapshot'

let root: string

function write(path: string, content: string) {
  const target = join(root, path)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, content)
}

function git(...args: string[]) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim()
}

function commit() {
  git('add', '.')
  git(
    '-c',
    'user.name=Test',
    '-c',
    'commit.gpgsign=false',
    '-c',
    'core.hooksPath=/dev/null',
    '-c',
    'user.email=test@example.test',
    'commit',
    '-m',
    'Baseline fixture'
  )
  return git('rev-parse', 'HEAD')
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'registry-snapshot-test-'))
  git('init', '--quiet')
  write('.gitignore', 'node_modules\n')
  write('apps/sim/package.json', JSON.stringify({ name: '@sim/app', type: 'module' }))
  write(
    'apps/sim/tsconfig.json',
    JSON.stringify({ compilerOptions: { paths: { '@/*': ['./*'] } } })
  )
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('readBlockRegistryAtRef', () => {
  it('reads effective IDs from spreads, local arrays, helpers, and derived blocks at the base revision', () => {
    write(
      'apps/sim/blocks/registry.ts',
      `
import { sharedFields } from '@sim/fields'
import { triggerFields } from '@/triggers/fields'
const localFields = [{ id: 'operation', options: [{ id: 'nested-option' }] }, { id: 'encoding' }]
const LegacyBlock = { type: 'legacy', subBlocks: localFields } satisfies { type: string; subBlocks: { id: string }[] }
const CurrentBlock = { ...LegacyBlock, type: 'current', subBlocks: LegacyBlock.subBlocks.filter(field => field.id !== 'encoding') }
const makeFields = () => [...sharedFields, ...triggerFields]
const SpreadBlock = { type: 'spread', subBlocks: [...localFields, ...makeFields()] }
export const getBlockRegistry = () => ({ legacy: LegacyBlock, current: CurrentBlock, spread: SpreadBlock })
`
    )
    write('apps/sim/triggers/fields.ts', "export const triggerFields = [{ id: 'trigger' }]\n")
    write(
      'packages/fields/package.json',
      JSON.stringify({ name: '@sim/fields', type: 'module', exports: './index.ts' })
    )
    write('packages/fields/index.ts', "export const sharedFields = [{ id: 'shared' }]\n")
    const base = commit()
    mkdirSync(join(root, 'node_modules/@sim'), { recursive: true })
    symlinkSync(join(root, 'packages/fields'), join(root, 'node_modules/@sim/fields'), 'dir')
    write(
      'packages/fields/index.ts',
      "export const sharedFields = [{ id: 'changed-after-base' }]\n"
    )
    write('apps/sim/triggers/fields.ts', 'export const triggerFields = []\n')
    const statusBefore = git('status', '--porcelain')

    expect(readBlockRegistryAtRef(root, base)).toEqual({
      legacy: ['operation', 'encoding'],
      current: ['operation'],
      spread: ['operation', 'encoding', 'shared', 'trigger'],
    })
    expect(git('status', '--porcelain')).toBe(statusBefore)
    expect(readFileSync(join(root, 'packages/fields/index.ts'), 'utf8')).toContain(
      'changed-after-base'
    )
  })

  it('keeps installed third-party dependencies available without treating their output as registry JSON', () => {
    write(
      'apps/sim/blocks/registry.ts',
      `
import { field } from 'fixture-provider'
console.log('Registry initialization diagnostic')
export const getBlockRegistry = () => ({ block: { type: 'block', subBlocks: [field] } })
`
    )
    const base = commit()
    write(
      'node_modules/fixture-provider/package.json',
      JSON.stringify({ name: 'fixture-provider', type: 'module', exports: './index.js' })
    )
    write(
      'node_modules/fixture-provider/index.js',
      "export const field = { id: 'installed-field' }\n"
    )

    expect(readBlockRegistryAtRef(root, base)).toEqual({ block: ['installed-field'] })
  })

  it('fails instead of returning partial IDs when a derived definition cannot load', () => {
    write(
      'apps/sim/blocks/registry.ts',
      `
import { missingFields } from './missing'
export const getBlockRegistry = () => ({ block: { type: 'block', subBlocks: missingFields } })
`
    )
    const base = commit()
    expect(() => readBlockRegistryAtRef(root, base)).toThrow()
  })

  it('fails when the requested base revision is unavailable', () => {
    write('apps/sim/blocks/registry.ts', 'export const getBlockRegistry = () => ({})\n')
    commit()
    expect(() => readBlockRegistryAtRef(root, 'missing-base')).toThrow()
  })
})

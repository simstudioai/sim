import { spawnSync } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const script = resolve(import.meta.dirname, 'prune-turbopack-cache.mts')
const fixtures: string[] = []

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'sim-compiler-cache-'))
  fixtures.push(root)
  const build = join(root, '.next/cache')
  const dev = join(root, '.next/dev/cache/turbopack')
  const outside = join(root, 'unrelated')
  for (const dir of [build, dev, outside]) {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'state'), Buffer.alloc(4_096))
  }
  const nested = join(build, 'nested', 'state')
  mkdirSync(nested, { recursive: true })
  for (let index = 0; index < 40; index++) writeFileSync(join(nested, String(index)), 'x')
  symlinkSync(outside, join(build, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
  return { root, build, dev, outside }
}

function run(root: string, args: string[], maximum = '0.000001') {
  return spawnSync(args.includes('--build') ? 'node' : 'bun', [script, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 10_000,
    env: { ...process.env, SIM_TURBOPACK_CACHE_MAX_GB: maximum },
  })
}

afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('compiler cache maintenance through the real CLI', () => {
  it.each(['size', 'force'])(
    'clears only build contents by %s while preserving its mount',
    (mode) => {
      const { root, build, dev, outside } = fixture()
      const inode = statSync(build).ino
      const result = run(
        root,
        mode === 'force' ? ['--build', '--force'] : ['--build'],
        mode === 'force' ? '1' : undefined
      )
      expect(result.status, result.stderr).toBe(0)
      expect(existsSync(build)).toBe(true)
      expect(statSync(build).ino).toBe(inode)
      expect(readdirSync(build)).toEqual([])
      expect(existsSync(join(dev, 'state'))).toBe(true)
      expect(existsSync(join(outside, 'state'))).toBe(true)
    }
  )

  it('retains useful build state without counting external symlink targets', () => {
    const { root, build, dev, outside } = fixture()
    const inode = statSync(build).ino
    const buildBytes = readFileSync(join(build, 'state'))
    const devBytes = readFileSync(join(dev, 'state'))
    const outsideBytes = readFileSync(join(outside, 'state'))
    expect(run(root, ['--build'], '0.000006').status).toBe(0)
    expect(statSync(build).ino).toBe(inode)
    expect(readFileSync(join(build, 'state'))).toEqual(buildBytes)
    expect(readFileSync(join(dev, 'state'))).toEqual(devBytes)
    expect(readFileSync(join(outside, 'state'))).toEqual(outsideBytes)
  })

  it('does not substitute dev state when the build cache is absent', () => {
    const { root, build, dev } = fixture()
    rmSync(build, { recursive: true })
    expect(run(root, ['--build']).status).toBe(0)
    expect(existsSync(join(dev, 'state'))).toBe(true)
  })

  it('rejects a non-directory ancestor instead of treating it as an absent build cache', () => {
    const { root, outside } = fixture()
    const parent = join(root, '.next')
    rmSync(parent, { recursive: true })
    writeFileSync(parent, 'unrelated parent file')
    const result = run(root, ['--build'])
    expect(result.status, result.stderr).not.toBe(0)
    expect(readFileSync(parent, 'utf8')).toBe('unrelated parent file')
    expect(existsSync(join(outside, 'state'))).toBe(true)
  })

  it('keeps the existing dev command scoped to dev state', () => {
    const { root, build, dev, outside } = fixture()
    expect(run(root, []).status).toBe(0)
    expect(existsSync(dev)).toBe(false)
    expect(existsSync(join(build, 'state'))).toBe(true)
    expect(existsSync(join(outside, 'state'))).toBe(true)
  })

  it.each(['size', 'force'])(
    'unlinks a dev root symlink by %s without traversing its target',
    (mode) => {
      const { root, build, dev, outside } = fixture()
      rmSync(dev, { recursive: true })
      symlinkSync(outside, dev, process.platform === 'win32' ? 'junction' : 'dir')
      const outsideBytes = readFileSync(join(outside, 'state'))
      const result = run(
        root,
        mode === 'force' ? ['--force'] : [],
        mode === 'force' ? '1' : undefined
      )
      expect(result.status, result.stderr).toBe(0)
      expect(readFileSync(join(outside, 'state'))).toEqual(outsideBytes)
      expect(existsSync(dev)).toBe(false)
      expect(existsSync(join(build, 'state'))).toBe(true)
    }
  )

  it('leaves both caches intact for a build dry run', () => {
    const { root, build, dev } = fixture()
    expect(run(root, ['--build', '--dry-run']).status).toBe(0)
    expect(existsSync(join(build, 'state'))).toBe(true)
    expect(existsSync(join(dev, 'state'))).toBe(true)
  })

  it.each([true, false])(
    'refuses a symlink build root when target existence is %s',
    (targetExists) => {
      const { root, build, dev, outside } = fixture()
      rmSync(build, { recursive: true })
      symlinkSync(outside, build, process.platform === 'win32' ? 'junction' : 'dir')
      if (!targetExists) rmSync(outside, { recursive: true })
      const result = run(root, ['--build', '--force'])
      expect(result.status, result.stderr).not.toBe(0)
      expect(lstatSync(build).isSymbolicLink()).toBe(true)
      expect(existsSync(join(outside, 'state'))).toBe(targetExists)
      expect(existsSync(join(dev, 'state'))).toBe(true)
    }
  )
})

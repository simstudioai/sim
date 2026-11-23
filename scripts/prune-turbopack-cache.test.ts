import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
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
  return spawnSync('bun', [script, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 10_000,
    env: { ...process.env, SIM_TURBOPACK_CACHE_MAX_GB: maximum },
  })
}

afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('dev cache maintenance through the real CLI', () => {
  it('prunes only dev state, never the build cache or other directories', () => {
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

  it('keeps dev state on a dry run over the cap', () => {
    const { root, build, dev } = fixture()
    expect(run(root, ['--dry-run']).status).toBe(0)
    expect(existsSync(join(dev, 'state'))).toBe(true)
    expect(existsSync(join(build, 'state'))).toBe(true)
  })
})

/**
 * @vitest-environment node
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installUpdate, type PackageManager } from '#sim-cli/update/install'

let directory: string
let packageRoot: string
let modulePath: string
let output: string[]

function writeVersion(version: string, root = packageRoot): void {
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'sim', version }))
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'sim-cli-install-update-'))
  packageRoot = join(directory, 'node_modules/sim')
  modulePath = join(packageRoot, 'dist/index.js')
  mkdirSync(dirname(modulePath), { recursive: true })
  writeFileSync(modulePath, '')
  writeVersion('2.1.2')
  output = []
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

function options() {
  return {
    modulePath,
    env: {},
    currentVersion: '2.1.2',
    write: (message: string) => output.push(message),
  }
}

describe('installing a CLI update', () => {
  it.each<PackageManager>(['npm', 'pnpm', 'bun', 'yarn'])(
    'updates the active global copy with %s',
    async (packageManager) => {
      const bin = join(directory, 'bin')
      mkdirSync(bin)
      symlinkSync(modulePath, join(bin, 'sim'))
      const globalDirectory =
        packageManager === 'bun'
          ? bin
          : packageManager === 'yarn'
            ? directory
            : join(directory, 'node_modules')
      const run = vi
        .fn()
        .mockResolvedValueOnce(globalDirectory)
        .mockImplementationOnce(() => {
          writeVersion('2.1.5')
          return Promise.resolve('')
        })

      await installUpdate({ ...options(), packageManager, run })

      const expectedArgs =
        packageManager === 'npm'
          ? ['install', '-g', 'sim@latest']
          : packageManager === 'yarn'
            ? ['global', 'add', 'sim@latest']
            : ['add', '-g', 'sim@latest']
      expect(run).toHaveBeenLastCalledWith(packageManager, expectedArgs, {
        env: { SIM_NO_UPDATE_CHECK: '1' },
        capture: false,
      })
      expect(output.join('')).toContain('Updated Sim 2.1.2 → 2.1.5')
      expect(existsSync(`${packageRoot}.lock`)).toBe(false)
    }
  )

  it.each([
    ['2.1.2', 'latest'],
    ['2.1.2-preview.123.1', 'staging'],
    ['2.1.2-dev.123.1', 'dev'],
  ])('preserves the release channel for %s', async (currentVersion, tag) => {
    writeVersion(currentVersion)
    const run = vi.fn().mockResolvedValue(join(directory, 'node_modules'))
    await installUpdate({ ...options(), currentVersion, run })
    expect(run.mock.calls[1][1]).toEqual(['install', '-g', `sim@${tag}`])
  })

  it('does not pass the Sim API key to the package manager or change the parent environment', async () => {
    const env = { SIM_API_KEY: 'private', npm_config_registry: 'https://registry.example' }
    const run = vi.fn().mockResolvedValue(join(directory, 'node_modules'))
    await installUpdate({ ...options(), env, run })
    expect(run.mock.calls[1][2].env).toEqual({
      npm_config_registry: 'https://registry.example',
      SIM_NO_UPDATE_CHECK: '1',
    })
    expect(env.SIM_API_KEY).toBe('private')
  })

  it('reports an already current installation', async () => {
    await installUpdate({
      ...options(),
      run: vi.fn().mockResolvedValue(join(directory, 'node_modules')),
    })
    expect(output.join('')).toContain('already up to date')
  })

  it('verifies the new pnpm symlink instead of reading the old version directory', async () => {
    const globalRoot = join(directory, 'global/node_modules')
    mkdirSync(globalRoot, { recursive: true })
    const link = join(globalRoot, 'sim')
    symlinkSync(packageRoot, link)
    const nextRoot = join(directory, 'next/node_modules/sim')
    mkdirSync(join(nextRoot, 'dist'), { recursive: true })
    writeFileSync(join(nextRoot, 'dist/index.js'), '')
    writeVersion('2.1.5', nextRoot)
    const run = vi
      .fn()
      .mockResolvedValueOnce(globalRoot)
      .mockImplementationOnce(() => {
        unlinkSync(link)
        symlinkSync(nextRoot, link)
        return Promise.resolve('')
      })
    await installUpdate({ ...options(), packageManager: 'pnpm', run })
    expect(output.join('')).toContain('Updated Sim 2.1.2 → 2.1.5')
  })

  it('refuses to update another installation even when both versions match', async () => {
    const other = join(directory, 'other/node_modules')
    mkdirSync(join(other, 'sim/dist'), { recursive: true })
    writeFileSync(join(other, 'sim/dist/index.js'), '')
    const run = vi.fn().mockResolvedValue(other)
    await expect(installUpdate({ ...options(), run })).rejects.toThrow('different Sim installation')
    expect(run).toHaveBeenCalledTimes(1)
  })

  it.each(['relative/path', '/path\nextra output', ''])(
    'refuses an invalid package-manager directory: %s',
    async (path) => {
      const run = vi.fn().mockResolvedValue(path)
      await expect(installUpdate({ ...options(), run })).rejects.toThrow(
        'valid global installation path'
      )
      expect(run).toHaveBeenCalledTimes(1)
    }
  )

  it.each([
    'checkout/src/index.ts',
    '_npx/cache/node_modules/sim/dist/index.js',
    'bunx-123/node_modules/sim/dist/index.js',
  ])('refuses a checkout or temporary installation: %s', async (path) => {
    const entry = join(directory, path)
    mkdirSync(dirname(entry), { recursive: true })
    writeFileSync(entry, '')
    const run = vi.fn()
    await expect(installUpdate({ ...options(), modulePath: entry, run })).rejects.toThrow(
      'global installation'
    )
    expect(run).not.toHaveBeenCalled()
  })

  it('refuses npm exec without spawning a package manager', async () => {
    const run = vi.fn()
    await expect(
      installUpdate({ ...options(), env: { npm_command: 'exec' }, run })
    ).rejects.toThrow('global installation')
    expect(run).not.toHaveBeenCalled()
  })

  it('fails on an unknown prerelease channel', async () => {
    const run = vi.fn()
    await expect(
      installUpdate({ ...options(), currentVersion: '2.1.2-beta.1', run })
    ).rejects.toThrow('release channel')
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects executable text in the version before running anything', async () => {
    const run = vi.fn()
    await expect(
      installUpdate({ ...options(), currentVersion: '2.1.5; echo unsafe', run })
    ).rejects.toThrow('release channel')
    expect(run).not.toHaveBeenCalled()
  })

  it('propagates installer failure, releases the lock, and never reports success', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce(join(directory, 'node_modules'))
      .mockRejectedValueOnce(new Error('permission denied'))
    await expect(installUpdate({ ...options(), run })).rejects.toThrow('permission denied')
    expect(existsSync(`${packageRoot}.lock`)).toBe(false)
    expect(output.join('')).not.toContain('Updated Sim')
  })

  it.each(['invalid', '2.1.5-dev.1.1'])(
    'rejects an invalid or wrong-channel installed version: %s',
    async (version) => {
      const run = vi
        .fn()
        .mockResolvedValueOnce(join(directory, 'node_modules'))
        .mockImplementationOnce(() => {
          writeVersion(version)
          return Promise.resolve('')
        })
      await expect(installUpdate({ ...options(), run })).rejects.toThrow('release channel')
      expect(output.join('')).not.toContain('Updated Sim')
    }
  )

  it('refuses concurrent updates before a second installer starts', async () => {
    mkdirSync(`${packageRoot}.lock`)
    const run = vi.fn().mockResolvedValue(join(directory, 'node_modules'))
    await expect(installUpdate({ ...options(), run })).rejects.toThrow('already being held')
    expect(run).toHaveBeenCalledTimes(1)
  })
})

/**
 * @vitest-environment node
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CliUpdateError, installUpdate, type PackageManager } from '#sim-cli/update/install'

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
        .mockResolvedValueOnce(
          packageManager === 'yarn'
            ? JSON.stringify({ type: 'inspect', data: '2.1.5' }) +
                '\n' +
                JSON.stringify({ type: 'finished', data: 1 })
            : JSON.stringify('2.1.5')
        )
        .mockImplementationOnce(() => {
          writeVersion('2.1.5')
          return Promise.resolve('')
        })

      await installUpdate({ ...options(), packageManager, run })

      const expectedArgs =
        packageManager === 'npm'
          ? ['install', '-g', 'sim@2.1.5']
          : packageManager === 'yarn'
            ? ['global', 'add', 'sim@2.1.5']
            : ['add', '-g', 'sim@2.1.5']
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
    const run = vi
      .fn()
      .mockResolvedValueOnce(join(directory, 'node_modules'))
      .mockResolvedValueOnce(JSON.stringify(currentVersion))
    await installUpdate({ ...options(), currentVersion, run })
    expect(run.mock.calls[1][1]).toEqual(['view', `sim@${tag}`, 'version', '--json'])
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('does not pass the Sim API key to the package manager or change the parent environment', async () => {
    const env = { SIM_API_KEY: 'private', npm_config_registry: 'https://registry.example' }
    const run = vi
      .fn()
      .mockResolvedValueOnce(join(directory, 'node_modules'))
      .mockResolvedValueOnce(JSON.stringify('2.1.2'))
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
      run: vi
        .fn()
        .mockResolvedValueOnce(join(directory, 'node_modules'))
        .mockResolvedValueOnce(JSON.stringify('2.1.2')),
    })
    expect(output.join('')).toContain('already up to date')
  })

  it.each([
    ['2.1.5', '2.1.2'],
    ['2.1.10', '2.1.9'],
    ['3.0.0', '2.99.99'],
    ['2.1.5-preview.10.1', '2.1.5-preview.9.9'],
    ['2.1.5-dev.10.2', '2.1.5-dev.10.1'],
  ])('refuses to downgrade %s to %s before installation', async (currentVersion, candidate) => {
    writeVersion(currentVersion)
    const run = vi
      .fn()
      .mockResolvedValueOnce(join(directory, 'node_modules'))
      .mockResolvedValueOnce(JSON.stringify(candidate))
    await expect(installUpdate({ ...options(), currentVersion, run })).rejects.toThrow(
      'Refusing to downgrade'
    )
    expect(run).toHaveBeenCalledTimes(2)
    expect(readFileSync(join(packageRoot, 'package.json'), 'utf8')).toContain(currentVersion)
    expect(existsSync(`${packageRoot}.lock`)).toBe(false)
  })

  it.each([
    ['2.1.9', '2.1.10'],
    ['2.1.5-preview.9.9', '2.1.5-preview.10.1'],
    ['2.1.5-dev.10.9', '2.1.5-dev.10.10'],
  ])(
    'compares numeric release components when updating %s to %s',
    async (currentVersion, candidate) => {
      writeVersion(currentVersion)
      const run = vi
        .fn()
        .mockResolvedValueOnce(join(directory, 'node_modules'))
        .mockResolvedValueOnce(JSON.stringify(candidate))
        .mockImplementationOnce(async () => {
          writeVersion(candidate)
          return ''
        })
      await installUpdate({ ...options(), currentVersion, run })
      expect(run.mock.calls[2][1]).toEqual(['install', '-g', `sim@${candidate}`])
    }
  )

  it('does not reinstall versions that differ only in build metadata', async () => {
    writeVersion('2.1.2+local')
    const run = vi
      .fn()
      .mockResolvedValueOnce(join(directory, 'node_modules'))
      .mockResolvedValueOnce(JSON.stringify('2.1.2+registry'))
    await installUpdate({ ...options(), currentVersion: '2.1.2+local', run })
    expect(run).toHaveBeenCalledTimes(2)
    expect(output.join('')).toContain('already up to date')
  })

  it.each([
    '"2.1.5-dev.1.1"',
    '"invalid"',
    '"2.1.5; echo unsafe"',
    '"2.1.05"',
    '{',
    '["2.1.5"]',
    'null',
  ])(
    'rejects invalid or wrong-channel registry metadata without installing: %s',
    async (metadata) => {
      const run = vi
        .fn()
        .mockResolvedValueOnce(join(directory, 'node_modules'))
        .mockResolvedValueOnce(metadata)
      await expect(installUpdate({ ...options(), run })).rejects.toBeInstanceOf(CliUpdateError)
      expect(run).toHaveBeenCalledTimes(2)
      expect(output).toEqual([])
    }
  )

  it('rejects ambiguous Yarn version events', async () => {
    const event = JSON.stringify({ type: 'inspect', data: '2.1.5' })
    const run = vi.fn().mockResolvedValueOnce(directory).mockResolvedValueOnce(`${event}\n${event}`)
    await expect(installUpdate({ ...options(), packageManager: 'yarn', run })).rejects.toThrow(
      'single Sim release'
    )
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('refuses to install if the current installation changed while locating it', async () => {
    const run = vi.fn().mockImplementationOnce(async () => {
      writeVersion('2.1.6')
      return join(directory, 'node_modules')
    })
    await expect(installUpdate({ ...options(), run })).rejects.toThrow('installation changed')
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('normalizes a missing installation entry', async () => {
    const run = vi.fn().mockResolvedValue(join(directory, 'missing'))
    await expect(installUpdate({ ...options(), run })).rejects.toMatchObject({
      constructor: CliUpdateError,
      message: expect.stringContaining('Cannot access the Sim installation'),
    })
  })

  it.each(['missing', 'malformed', 'directory'])(
    'normalizes a %s installed manifest',
    async (failure) => {
      const manifestPath = join(packageRoot, 'package.json')
      rmSync(manifestPath)
      if (failure === 'malformed') writeFileSync(manifestPath, '{')
      if (failure === 'directory') mkdirSync(manifestPath)
      const run = vi.fn().mockResolvedValue(join(directory, 'node_modules'))
      await expect(installUpdate({ ...options(), run })).rejects.toMatchObject({
        constructor: CliUpdateError,
        message: expect.stringContaining('Cannot read the installed Sim manifest'),
      })
      expect(existsSync(`${packageRoot}.lock`)).toBe(false)
    }
  )

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
      .mockResolvedValueOnce(JSON.stringify('2.1.5'))
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
      .mockResolvedValueOnce(JSON.stringify('2.1.5'))
      .mockRejectedValueOnce(new Error('permission denied'))
    await expect(installUpdate({ ...options(), run })).rejects.toThrow('permission denied')
    expect(existsSync(`${packageRoot}.lock`)).toBe(false)
    expect(output.join('')).not.toContain('Updated Sim')
  })

  it.each(['registry', 'installer'])(
    'preserves the original %s failure when releasing the lock also fails',
    async (phase) => {
      const failure = new CliUpdateError(`${phase} permission denied`)
      const run = vi.fn().mockResolvedValueOnce(join(directory, 'node_modules'))
      if (phase === 'installer') run.mockResolvedValueOnce(JSON.stringify('2.1.5'))
      run.mockImplementationOnce(async () => {
        writeFileSync(join(`${packageRoot}.lock`, 'obstruction'), '')
        throw failure
      })

      await expect(installUpdate({ ...options(), run })).rejects.toBe(failure)
      expect(output.join('')).toContain('Cannot release the Sim update lock')
      expect(output.join('')).not.toContain('Updated Sim')
    }
  )

  it('fails with a CLI error when only releasing the lock fails', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce(join(directory, 'node_modules'))
      .mockImplementationOnce(async () => {
        writeFileSync(join(`${packageRoot}.lock`, 'obstruction'), '')
        return JSON.stringify('2.1.2')
      })

    await expect(installUpdate({ ...options(), run })).rejects.toMatchObject({
      constructor: CliUpdateError,
      message: expect.stringContaining('Cannot release the Sim update lock'),
      cause: expect.objectContaining({ code: 'ENOTEMPTY' }),
    })
  })

  it.each(['invalid', '2.1.5-dev.1.1'])(
    'rejects an invalid or wrong-channel installed version: %s',
    async (version) => {
      const run = vi
        .fn()
        .mockResolvedValueOnce(join(directory, 'node_modules'))
        .mockResolvedValueOnce(JSON.stringify('2.1.5'))
        .mockImplementationOnce(() => {
          writeVersion(version)
          return Promise.resolve('')
        })
      await expect(installUpdate({ ...options(), run })).rejects.toThrow('expected Sim version')
      expect(output.join('')).not.toContain('Updated Sim')
    }
  )

  it('refuses concurrent updates before a second installer starts', async () => {
    mkdirSync(`${packageRoot}.lock`)
    const run = vi.fn().mockResolvedValue(join(directory, 'node_modules'))
    await expect(installUpdate({ ...options(), run })).rejects.toMatchObject({
      constructor: CliUpdateError,
      message: expect.stringContaining('already being held'),
    })
    expect(run).toHaveBeenCalledTimes(1)
  })
})

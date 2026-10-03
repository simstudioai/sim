import { execFileSync, spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { CliUpdateError, installUpdate } from '#sim-cli/update/install'

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

  it('refuses to install if the current installation changed while locating it', async () => {
    const run = vi.fn().mockImplementationOnce(async () => {
      writeVersion('2.1.6')
      return join(directory, 'node_modules')
    })
    await expect(installUpdate({ ...options(), run })).rejects.toThrow('installation changed')
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('refuses to update another installation even when both versions match', async () => {
    const other = join(directory, 'other/node_modules')
    mkdirSync(join(other, 'sim/dist'), { recursive: true })
    writeFileSync(join(other, 'sim/dist/index.js'), '')
    const run = vi.fn().mockResolvedValue(other)
    await expect(installUpdate({ ...options(), run })).rejects.toThrow('different Sim installation')
    expect(run).toHaveBeenCalledTimes(1)
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

describe.skipIf(process.platform === 'win32')('the bundled sim update command', () => {
  let directory: string
  let entrypoint: string
  let manifest: string
  let bin: string
  let modules: string

  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), 'sim-cli-update-process-'))
    modules = join(directory, 'node_modules')
    entrypoint = join(modules, 'sim/dist/index.js')
    manifest = join(modules, 'sim/package.json')
    bin = join(directory, 'bin')
    mkdirSync(bin)
    execFileSync('bun', [
      'build',
      fileURLToPath(new URL('../index.ts', import.meta.url)),
      '--target=node',
      '--format=esm',
      '--packages=bundle',
      '--outfile',
      entrypoint,
    ])
  })

  beforeEach(() => {
    writeFileSync(manifest, JSON.stringify({ name: 'sim', type: 'module', version: '2.1.2' }))
  })

  afterAll(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  function fakePackageManager(
    exitCode = 0,
    version = '2.1.5',
    manifestBody?: string,
    globalDirectory = modules
  ): void {
    const script = `
  if (process.env.SIM_API_KEY) throw new Error('Sim API key leaked to package manager')
  const args = process.argv.slice(2)
  if (args.join(' ') === 'root -g') {
    process.stdout.write(${JSON.stringify(globalDirectory)})
  } else if (args.join(' ') === 'view sim@latest version --json') {
    process.stdout.write(JSON.stringify(${JSON.stringify(version)}))
  } else if (args.join(' ') === 'install -g sim@' + ${JSON.stringify(version)}) {
    process.stdout.write('package manager stdout\\n')
    process.stderr.write('package manager stderr\\n')
    if (${exitCode} !== 0) process.exit(${exitCode})
    require('node:fs').writeFileSync(${JSON.stringify(manifest)}, ${JSON.stringify(manifestBody ?? JSON.stringify({ name: 'sim', type: 'module', version }))})
  } else {
    throw new Error('Unexpected arguments: ' + args.join(' '))
  }
  `
    const executable = join(bin, 'npm')
    writeFileSync(executable, `#!/usr/bin/env node\n${script}`)
    chmodSync(executable, 0o755)
  }

  function run(args: string[]) {
    return spawnSync(process.execPath, [entrypoint, ...args], {
      encoding: 'utf8',
      timeout: 15_000,
      env: {
        ...process.env,
        PATH: `${bin}${delimiter}${process.env.PATH}`,
        SIM_CONFIG_DIR: join(directory, 'no-profile'),
        SIM_API_KEY: 'must-not-reach-installer',
        SIM_NO_UPDATE_CHECK: '1',
        npm_command: '',
        npm_config_user_agent: '',
      },
    })
  }

  it('exits unsuccessfully on an installer failure without printing success', () => {
    fakePackageManager(17)
    const result = run(['update'])
    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('exit 17')
    expect(result.stderr).not.toContain('Updated Sim')
    expect(run(['--version']).stdout.trim()).toBe('2.1.2')
  })

  it('refuses an older registry release without running the installer', () => {
    fakePackageManager(0, '2.1.1')
    const result = run(['update'])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Refusing to downgrade')
    expect(result.stderr).not.toContain('package manager stdout')
    expect(result.stderr).not.toMatch(/\n\s+at /)
    expect(run(['--version']).stdout.trim()).toBe('2.1.2')
  })
})

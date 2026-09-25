import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

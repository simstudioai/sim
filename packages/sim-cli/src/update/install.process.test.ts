/**
 * @vitest-environment node
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

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

function fakePackageManager(exitCode = 0): void {
  const script = `
if (process.env.SIM_API_KEY) throw new Error('Sim API key leaked to package manager')
const args = process.argv.slice(2)
if (args.join(' ') === 'root -g') {
  process.stdout.write(${JSON.stringify(modules)})
} else if (args.join(' ') === 'install -g sim@latest') {
  process.stdout.write('package manager stdout\\n')
  process.stderr.write('package manager stderr\\n')
  if (${exitCode} !== 0) process.exit(${exitCode})
  require('node:fs').writeFileSync(${JSON.stringify(manifest)}, JSON.stringify({ name: 'sim', type: 'module', version: '2.1.5' }))
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

describe.skipIf(process.platform === 'win32')('the bundled sim update command', () => {
  it('runs without login, updates the package, and keeps stdout clean', () => {
    fakePackageManager()
    const result = run(['update'])
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('package manager stdout')
    expect(result.stderr).toContain('package manager stderr')
    expect(result.stderr).toContain('Updated Sim 2.1.2 → 2.1.5')
    expect(run(['--version']).stdout.trim()).toBe('2.1.5')
  })

  it('exits unsuccessfully on an installer failure without printing success', () => {
    fakePackageManager(17)
    const result = run(['update'])
    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('exit 17')
    expect(result.stderr).not.toContain('Updated Sim')
    expect(run(['--version']).stdout.trim()).toBe('2.1.2')
  })

  it('answers update help without invoking the installer', () => {
    fakePackageManager(17)
    const result = run(['update', '--help'])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('sim update')
    expect(result.stdout).toContain('--package-manager')
    expect(result.stderr).toBe('')
  })
})

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  readConfigProfile,
  withCredentialsLock,
  writeConfigProfile,
  writeCredentialsProfile,
} from '../config/index'
import { configureCommand } from './configure'

const mocks = vi.hoisted(() => ({
  profileName: 'default',
  profileFrom: vi.fn(),
}))

vi.mock('../context', () => ({
  // The real one-liner: the root globals live on the root command, so the
  // refusal below only fires if the harness parses argv the way the shipped
  // program does.
  globalsOf: (command: Command) => command.optsWithGlobals(),
  profileFrom: mocks.profileFrom,
}))

let dir: string

function run(...args: string[]): Promise<Command> {
  // The three root globals are declared exactly as program.ts declares them, so
  // `configure --endpoint …` parses here the way it does in the shipped tree.
  const root = new Command('sim')
    .exitOverride()
    .option('-P, --profile <name>')
    .option('--endpoint <url>')
    .option('-w, --workspace <id>')
    .option('--output <format>')
  root.addCommand(configureCommand())
  return root.parseAsync(['node', 'sim', 'configure', ...args])
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sim-cli-'))
  process.env.SIM_CONFIG_DIR = dir
  // The refusal reads SIM_PROFILE the way `resolveProfile` does, so an ambient
  // one would otherwise decide what these assertions see. Empty rather than
  // `undefined`: assigning to process.env stringifies, and "undefined" is truthy.
  process.env.SIM_PROFILE = ''
  mocks.profileName = 'default'
  mocks.profileFrom.mockClear()
  mocks.profileFrom.mockImplementation(() => ({ name: mocks.profileName }))
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  process.env.SIM_CONFIG_DIR = undefined
  process.env.SIM_PROFILE = ''
})

describe('configure --set-endpoint', () => {
  it('refuses to store an endpoint that would later crash the URL parser', async () => {
    await expect(run('--set-endpoint', 'not-a-url')).rejects.toThrow(
      'Invalid endpoint "not-a-url" from --set-endpoint. Use an absolute URL, e.g. https://www.sim.ai or http://localhost:3000'
    )
    expect(readConfigProfile('default')).toEqual({})
  })

  it('rechecks an OAuth binding after taking the credential lock', async () => {
    mocks.profileFrom.mockReturnValue({
      name: 'default',
      endpoint: 'https://sim.example',
    })
    writeConfigProfile('default', { endpoint: 'https://sim.example' })

    let releaseHolder: (() => void) | undefined
    let holderAcquired: (() => void) | undefined
    const acquired = new Promise<void>((resolve) => {
      holderAcquired = resolve
    })
    const release = new Promise<void>((resolve) => {
      releaseHolder = resolve
    })
    const holder = withCredentialsLock(async () => {
      holderAcquired?.()
      await release
    })
    await acquired

    const configure = run('--set-endpoint', 'https://other.example')
    await new Promise<void>((resolve) => setImmediate(resolve))
    writeCredentialsProfile('default', {
      kind: 'oauth',
      oauth: {
        accessToken: 'sim_oat_access',
        refreshToken: 'sim_ort_refresh',
        expiresAt: Date.now() + 3_600_000,
        issuer: 'https://sim.example/api/auth',
        loginId: 'login-1',
        scope: 'offline_access api:read api:write',
      },
    })
    releaseHolder?.()
    await holder

    await expect(configure).rejects.toThrow('has an OAuth login bound to')
    expect(readConfigProfile('default')).toEqual({ endpoint: 'https://sim.example' })
  })

  it('refuses to set an endpoint locally on a shared workspace profile', async () => {
    writeConfigProfile('default', { endpoint: 'https://sim.example' })
    writeCredentialsProfile('default', { kind: 'api_key', apiKey: 'stored-key' })
    writeConfigProfile('acme', { auth_profile: 'default', workspace: 'ws_acme' })
    mocks.profileName = 'acme'

    await expect(run('--set-endpoint', 'https://other.example')).rejects.toThrow(
      'Profile "acme" shares its endpoint with authentication profile "default".'
    )
    expect(readConfigProfile('acme')).toEqual({
      auth_profile: 'default',
      workspace: 'ws_acme',
    })
  })
})

describe('configure --set-workspace', () => {
  /**
   * A stored value is read back as a real setting, so a value carrying a line
   * break used to add a setting nobody typed — `endpoint` included, which is
   * what decides where the API key is sent. Its sibling `--set-endpoint` has
   * been validated all along; this is the same check for the other value.
   */
  it('refuses a workspace value that would inject another setting', async () => {
    await expect(
      run('--set-workspace', 'ws_1\nendpoint = http://elsewhere.invalid')
    ).rejects.toThrow(/Invalid workspace id/)

    expect(readConfigProfile('default')).toEqual({})
  })
})

/**
 * The root globals are transient overrides on every other command, so
 * `configure --endpoint …` discarded the value and exited 0 after printing the
 * settings it had not changed — which reads like a confirmation.
 */
describe('configure and the root globals', () => {
  /**
   * The refusal prints a command for the caller to run, so an unredacted value
   * carrying U+2028 rendered as a second line that reads like a suggestion of
   * its own.
   */
  it('redacts a control character out of the command it suggests', async () => {
    await expect(run('--endpoint', 'https://a.example\u2028sim login --api-key x')).rejects.toThrow(
      'sim configure --set-endpoint https://a.example sim login --api-key x'
    )
  })

  /**
   * Profile-name validation is creation-only by design, so a hand-written
   * `[profile my stack]` keeps resolving and reaches this suggestion. Unquoted,
   * a name carrying a `;` would end the pasted command and start another.
   */
  it('quotes a profile name a pasted command would otherwise split', async () => {
    await expect(run('-P', 'my stack', '--output', 'json')).rejects.toThrow(
      "sim configure --profile 'my stack' --set-output json"
    )
    await expect(run('-P', 'a;rm -rf x', '--output', 'json')).rejects.toThrow(
      "sim configure --profile 'a;rm -rf x' --set-output json"
    )
    await expect(run('-P', "it's mine", '--output', 'json')).rejects.toThrow(
      "sim configure --profile 'it'\\''s mine' --set-output json"
    )
  })
})

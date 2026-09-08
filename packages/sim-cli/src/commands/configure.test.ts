import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  listProfiles,
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
  vi.restoreAllMocks()
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

  it('refuses a scheme the HTTP client cannot speak', async () => {
    await expect(run('--set-endpoint', 'ftp://x.com')).rejects.toThrow(
      'Unsupported endpoint scheme "ftp" from --set-endpoint. Use http or https, e.g. https://www.sim.ai'
    )
    expect(readConfigProfile('default')).toEqual({})
  })

  it('stores a self-hosted endpoint with its trailing slashes stripped', async () => {
    await run('--set-endpoint', 'http://localhost:3000//')
    expect(readConfigProfile('default')).toMatchObject({ endpoint: 'http://localhost:3000' })
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

  it('refuses an empty value instead of silently ignoring the flag', async () => {
    // An empty string is falsy, so the setter fell through to the "print
    // current settings" branch and exited 0 having done nothing.
    await expect(run('--set-endpoint', '')).rejects.toThrow(
      '--set-endpoint requires a value. To remove it, run: sim configure --unset endpoint'
    )
    await expect(run('--set-workspace', '  ')).rejects.toThrow(
      '--set-workspace requires a value. To remove it, run: sim configure --unset workspace'
    )
    await expect(run('--set-output', '')).rejects.toThrow(
      '--set-output requires a value. To remove it, run: sim configure --unset output'
    )
    expect(readConfigProfile('default')).toEqual({})
  })

  it('still removes a setting through --unset', async () => {
    writeConfigProfile('default', { endpoint: 'https://sim.example', workspace: 'ws_1' })

    await run('--unset', 'workspace')

    expect(readConfigProfile('default')).toEqual({ endpoint: 'https://sim.example' })
  })

  it('resolves a profile name that does not exist yet, because configure creates it', async () => {
    // Resolution rejects an unknown --profile so a typo cannot silently talk to
    // production. `configure --profile x --set-…` is one of the two documented
    // ways a profile comes into existence, so it is exempt.
    await run('--set-workspace', 'ws_new')

    expect(mocks.profileFrom).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ allowUnknownProfile: true })
    )
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

  it('stores an ordinary workspace id, trimmed', async () => {
    await run('--set-workspace', '  ws_new  ')
    expect(readConfigProfile('default')).toEqual({ workspace: 'ws_new' })
  })

  /**
   * `listProfiles` counts section names, so the empty section an unset used to
   * leave behind made the typo guard accept that name from then on.
   */
  it('creates nothing when unsetting on a profile that does not exist', async () => {
    mocks.profileName = 'fresh'

    await run('--unset', 'workspace')

    expect(readConfigProfile('fresh')).toEqual({})
    expect(listProfiles()).not.toContain('fresh')
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('No settings stored'))
  })
})

/**
 * The root globals are transient overrides on every other command, so
 * `configure --endpoint …` discarded the value and exited 0 after printing the
 * settings it had not changed — which reads like a confirmation.
 */
describe('configure and the root globals', () => {
  it('refuses --endpoint and names the flag that stores it', async () => {
    await expect(run('--endpoint', 'https://other.example')).rejects.toThrow(
      'sim configure --set-endpoint https://other.example'
    )
    expect(readConfigProfile('default')).toEqual({})
  })

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

  it('refuses -w and --output the same way', async () => {
    await expect(run('-w', 'ws_9')).rejects.toThrow('sim configure --set-workspace ws_9')
    await expect(run('--output', 'json')).rejects.toThrow('sim configure --set-output json')
    expect(readConfigProfile('default')).toEqual({})
  })

  /**
   * The suggested command is meant to be pasted verbatim, so omitting the
   * selected profile made it write `default` and leave the profile the caller
   * was targeting untouched — silently, and reported as a success.
   */
  it('carries the selected profile into the command it suggests', async () => {
    await expect(run('-P', 'dev', '--output', 'json')).rejects.toThrow(
      'sim configure --profile dev --set-output json'
    )
    await expect(run('-P', 'dev', '--endpoint', 'https://other.example')).rejects.toThrow(
      'sim configure --profile dev --set-endpoint https://other.example'
    )
    await expect(run('-P', 'dev', '-w', 'ws_9')).rejects.toThrow(
      'sim configure --profile dev --set-workspace ws_9'
    )
  })

  it('carries a SIM_PROFILE-selected profile into the command it suggests', async () => {
    process.env.SIM_PROFILE = 'dev'

    await expect(run('--output', 'json')).rejects.toThrow(
      'sim configure --profile dev --set-output json'
    )
  })

  /**
   * `resolveProfile` reads `overrides.profile || process.env.SIM_PROFILE`, so
   * the suggestion has to name the profile the run would actually resolve to.
   */
  it('lets an explicit --profile win over SIM_PROFILE, as resolveProfile does', async () => {
    process.env.SIM_PROFILE = 'staging'

    await expect(run('-P', 'dev', '--output', 'json')).rejects.toThrow(
      'sim configure --profile dev --set-output json'
    )
  })

  /**
   * The profile name is caller-supplied, so it is redacted like the value —
   * and redaction turns the separator into a space, which the suggestion then
   * has to quote to stay one argument.
   */
  it('redacts a control character out of the profile it suggests', async () => {
    await expect(run('-P', 'dev\u2028sim login', '--output', 'json')).rejects.toThrow(
      "sim configure --profile 'dev sim login' --set-output json"
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

  /** A name that already satisfies the creation rule needs no quoting noise. */
  it('leaves an ordinary profile name bare', async () => {
    await expect(run('-P', 'dev.2_a-b', '--output', 'json')).rejects.toThrow(
      'sim configure --profile dev.2_a-b --set-output json'
    )
  })

  it('does not print a stale stored value as if it had been set', async () => {
    writeConfigProfile('default', { endpoint: 'https://staging.example' })

    await expect(run('--endpoint', 'https://other.example')).rejects.toThrow('--set-endpoint')

    expect(console.log).not.toHaveBeenCalled()
    expect(readConfigProfile('default')).toEqual({ endpoint: 'https://staging.example' })
  })

  it('still prints stored settings and still stores a --set- flag', async () => {
    writeConfigProfile('default', { endpoint: 'https://staging.example' })

    await run()
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('https://staging.example'))

    await run('--set-endpoint', 'https://x.example')
    expect(readConfigProfile('default')).toMatchObject({ endpoint: 'https://x.example' })
  })
})

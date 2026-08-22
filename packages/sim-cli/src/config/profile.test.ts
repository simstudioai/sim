import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { configPath, credentialsPath } from './paths'
import {
  DEFAULT_ENDPOINT,
  deleteProfile,
  listAuthenticationDependents,
  listProfiles,
  OUTPUT_FORMATS,
  resolveAuthenticationProfileName,
  resolveProfile,
  writeConfigProfile,
  writeCredentialsProfile,
} from './profile'

let dir: string
const ENV_KEYS = ['SIM_PROFILE', 'SIM_ENDPOINT', 'SIM_API_KEY', 'SIM_WORKSPACE', 'SIM_OUTPUT']

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sim-cli-'))
  process.env.SIM_CONFIG_DIR = dir
  for (const key of ENV_KEYS) delete process.env[key]
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  process.env.SIM_CONFIG_DIR = undefined
  for (const key of ENV_KEYS) delete process.env[key]
})

describe('profile resolution', () => {
  it('falls back to built-in defaults with nothing configured', () => {
    const profile = resolveProfile()
    expect(profile.name).toBe('default')
    expect(profile.endpoint).toBe('https://www.sim.ai')
    expect(profile.apiKey).toBeNull()
    expect(profile.output).toBe('table')
    expect(profile.sources.apiKey).toBe('unset')
  })

  it('reads settings and credentials for the default profile', () => {
    writeConfigProfile('default', { endpoint: 'https://a.example', workspace: 'ws_1' })
    writeCredentialsProfile('default', 'sim_key')

    const profile = resolveProfile()
    expect(profile.endpoint).toBe('https://a.example')
    expect(profile.workspaceId).toBe('ws_1')
    expect(profile.apiKey).toBe('sim_key')
    expect(profile.sources).toMatchObject({ endpoint: 'config', apiKey: 'credentials' })
  })

  it('namespaces a non-default profile as [profile x] in config but [x] in credentials', () => {
    writeConfigProfile('dev', { endpoint: 'http://localhost:3000' })
    writeCredentialsProfile('dev', 'sim_dev')

    expect(readFileSync(configPath(), 'utf8')).toContain('[profile dev]')
    expect(readFileSync(credentialsPath(), 'utf8')).toContain('[dev]')
    expect(readFileSync(credentialsPath(), 'utf8')).not.toContain('[profile dev]')
  })

  it('keeps profiles isolated from one another', () => {
    writeConfigProfile('default', { endpoint: 'https://a.example', workspace: 'ws_a' })
    writeCredentialsProfile('default', 'key_a')
    writeConfigProfile('dev', { endpoint: 'http://localhost:3000', workspace: 'ws_b' })
    writeCredentialsProfile('dev', 'key_b')

    expect(resolveProfile()).toMatchObject({ workspaceId: 'ws_a', apiKey: 'key_a' })
    expect(resolveProfile({ profile: 'dev' })).toMatchObject({
      workspaceId: 'ws_b',
      apiKey: 'key_b',
    })
  })

  it('keeps existing profiles self-authenticating when auth_profile is absent', () => {
    writeConfigProfile('dev', { endpoint: 'https://dev.example', workspace: 'ws_dev' })
    writeCredentialsProfile('dev', 'key_dev')

    expect(resolveAuthenticationProfileName('dev')).toBe('dev')
    expect(resolveProfile({ profile: 'dev' })).toMatchObject({
      endpoint: 'https://dev.example',
      workspaceId: 'ws_dev',
      apiKey: 'key_dev',
    })
  })

  it('shares only authentication and endpoint through auth_profile', () => {
    writeConfigProfile('default', {
      endpoint: 'https://sim.example',
      workspace: 'ws_default',
      output: 'yaml',
    })
    writeCredentialsProfile('default', 'key_default')
    writeConfigProfile('acme', {
      auth_profile: 'default',
      workspace: 'ws_acme',
      output: 'json',
    })

    expect(resolveAuthenticationProfileName('acme')).toBe('default')
    expect(resolveProfile({ profile: 'acme' })).toMatchObject({
      name: 'acme',
      endpoint: 'https://sim.example',
      workspaceId: 'ws_acme',
      output: 'json',
      apiKey: 'key_default',
      sources: {
        endpoint: 'config',
        workspaceId: 'config',
        output: 'config',
        apiKey: 'credentials',
      },
    })
  })

  it('fails fast on empty, missing, self-referential, or chained auth profiles', () => {
    writeConfigProfile('empty', { auth_profile: '' })
    expect(() => resolveProfile({ profile: 'empty' })).toThrow(
      'Profile "empty" has an empty auth_profile.'
    )

    writeConfigProfile('missing', { auth_profile: 'gone' })
    expect(() => resolveProfile({ profile: 'missing' })).toThrow(
      'Profile "missing" references missing auth_profile "gone".'
    )

    writeConfigProfile('self', { auth_profile: 'self' })
    expect(() => resolveProfile({ profile: 'self' })).toThrow(
      'Profile "self" cannot use itself as auth_profile.'
    )

    writeConfigProfile('base', { auth_profile: 'root' })
    writeCredentialsProfile('root', 'key_root')
    writeConfigProfile('chained', { auth_profile: 'base' })
    expect(() => resolveProfile({ profile: 'chained' })).toThrow(
      'Profile "chained" references auth_profile "base", which also has auth_profile set.'
    )
  })

  it('rejects ambiguous local authentication settings on a shared profile', () => {
    writeCredentialsProfile('default', 'key_default')
    writeConfigProfile('endpoint-alias', {
      auth_profile: 'default',
      endpoint: 'https://other.example',
    })
    expect(() => resolveProfile({ profile: 'endpoint-alias' })).toThrow(
      'Profile "endpoint-alias" cannot set both auth_profile and endpoint.'
    )

    writeConfigProfile('key-alias', { auth_profile: 'default' })
    writeCredentialsProfile('key-alias', 'key_alias')
    expect(() => resolveProfile({ profile: 'key-alias' })).toThrow(
      'Profile "key-alias" cannot set both auth_profile and its own API key.'
    )
  })

  it('lets a flag beat the environment, and the environment beat the file', () => {
    writeConfigProfile('default', { endpoint: 'https://file.example' })

    expect(resolveProfile().endpoint).toBe('https://file.example')

    process.env.SIM_ENDPOINT = 'https://env.example'
    expect(resolveProfile()).toMatchObject({ endpoint: 'https://env.example' })
    expect(resolveProfile().sources.endpoint).toBe('env')

    expect(resolveProfile({ endpoint: 'https://flag.example' })).toMatchObject({
      endpoint: 'https://flag.example',
    })
    expect(resolveProfile({ endpoint: 'https://flag.example' }).sources.endpoint).toBe('flag')
  })

  it('selects the profile from SIM_PROFILE when no flag is given', () => {
    writeCredentialsProfile('dev', 'key_dev')
    process.env.SIM_PROFILE = 'dev'
    expect(resolveProfile()).toMatchObject({ name: 'dev', apiKey: 'key_dev' })
    expect(resolveProfile({ profile: 'default' }).name).toBe('default')
  })

  it('defaults to the host that serves the API, not the apex that redirects to it', () => {
    // `sim.ai` answers /api/** with a 301 to `www.sim.ai`, and the client
    // refuses redirects because following one rewrites a POST into a bodyless
    // GET. Defaulting to the apex therefore broke every command for anyone who
    // never set an endpoint, so the host itself is the assertion.
    expect(DEFAULT_ENDPOINT).toBe('https://www.sim.ai')
    expect(new URL(DEFAULT_ENDPOINT).hostname).toBe('www.sim.ai')
    expect(resolveProfile().endpoint).toBe(DEFAULT_ENDPOINT)
  })

  it('strips a trailing slash so paths do not double up', () => {
    expect(resolveProfile({ endpoint: 'https://sim.ai///' }).endpoint).toBe('https://sim.ai')
  })

  it('fails fast on an endpoint Node cannot parse, naming the source', () => {
    expect(() => resolveProfile({ endpoint: 'not-a-url' })).toThrow(
      'Invalid endpoint "not-a-url" from flag. Use an absolute URL, e.g. https://www.sim.ai or http://localhost:3000'
    )

    process.env.SIM_ENDPOINT = 'not-a-url'
    expect(() => resolveProfile()).toThrow('Invalid endpoint "not-a-url" from env.')

    Reflect.deleteProperty(process.env, 'SIM_ENDPOINT')
    writeConfigProfile('default', { endpoint: 'not-a-url' })
    expect(() => resolveProfile()).toThrow('Invalid endpoint "not-a-url" from config.')
  })

  it('rejects a parseable endpoint the HTTP client could never call', () => {
    expect(() => resolveProfile({ endpoint: 'ftp://x.com' })).toThrow(
      'Unsupported endpoint scheme "ftp" from flag. Use http or https, e.g. https://www.sim.ai'
    )
  })

  it('accepts every endpoint shape a self-hosted install needs', () => {
    for (const endpoint of [
      'http://localhost:3000',
      'https://10.0.0.7:8443',
      'https://sim.internal:8080/sim',
      'http://127.0.0.1:3000/',
    ]) {
      expect(resolveProfile({ endpoint }).endpoint).toBe(endpoint.replace(/\/+$/, ''))
    }
  })

  it('fails fast on an unrecognized active output format', () => {
    process.env.SIM_OUTPUT = 'xml'
    expect(() => resolveProfile()).toThrow(
      'Unknown output format "xml" from env. Use one of: table, json, yaml, text'
    )

    Reflect.deleteProperty(process.env, 'SIM_OUTPUT')
    writeConfigProfile('default', { output: 'xml' })
    expect(() => resolveProfile()).toThrow(
      'Unknown output format "xml" from config. Use one of: table, json, yaml, text'
    )
    expect(resolveProfile({ output: 'json' }).output).toBe('json')
  })

  it('resolves output from flag, environment, then profile', () => {
    writeConfigProfile('default', { output: 'yaml' })
    expect(resolveProfile()).toMatchObject({ output: 'yaml', sources: { output: 'config' } })

    process.env.SIM_OUTPUT = 'json'
    expect(resolveProfile()).toMatchObject({ output: 'json', sources: { output: 'env' } })

    expect(resolveProfile({ output: 'text' })).toMatchObject({
      output: 'text',
      sources: { output: 'flag' },
    })
  })

  it('accepts every documented output format from the environment', () => {
    for (const format of OUTPUT_FORMATS) {
      process.env.SIM_OUTPUT = format
      expect(resolveProfile().output).toBe(format)
    }
  })

  it('writes credentials 0600 even when the file already existed world-readable', () => {
    writeFileSync(credentialsPath(), '', { mode: 0o644 })
    writeCredentialsProfile('default', 'sim_key')
    expect(statSync(credentialsPath()).mode & 0o777).toBe(0o600)
  })

  it('lists profiles from both files without duplicating', () => {
    writeConfigProfile('default', { endpoint: 'https://a.example' })
    writeConfigProfile('dev', { endpoint: 'http://localhost:3000' })
    writeCredentialsProfile('dev', 'key')
    writeCredentialsProfile('ci', 'key')

    expect(listProfiles()).toEqual(['ci', 'default', 'dev'])
  })

  it('lists direct authentication dependents without treating a bad self-reference as one', () => {
    writeCredentialsProfile('default', 'key')
    writeConfigProfile('acme', { auth_profile: 'default', workspace: 'ws_acme' })
    writeConfigProfile('beta', { auth_profile: 'default', workspace: 'ws_beta' })
    writeConfigProfile('broken', { auth_profile: 'broken' })

    expect(listAuthenticationDependents('default')).toEqual(['acme', 'beta'])
    expect(listAuthenticationDependents('broken')).toEqual([])
  })

  it('deletes a profile from both files', () => {
    writeConfigProfile('dev', { endpoint: 'http://localhost:3000' })
    writeCredentialsProfile('dev', 'key')

    expect(deleteProfile('dev')).toEqual({ config: true, credentials: true })
    expect(listProfiles()).toEqual([])
    expect(deleteProfile('dev')).toEqual({ config: false, credentials: false })
  })

  it('clears just the key when the credential is removed', () => {
    writeConfigProfile('dev', { endpoint: 'http://localhost:3000' })
    writeCredentialsProfile('dev', 'key')
    writeCredentialsProfile('dev', null)

    expect(resolveProfile({ profile: 'dev' })).toMatchObject({
      apiKey: null,
      endpoint: 'http://localhost:3000',
    })
  })
})

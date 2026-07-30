import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { configPath, credentialsPath } from './paths.js'
import {
  deleteProfile,
  listProfiles,
  resolveProfile,
  writeConfigProfile,
  writeCredentialsProfile,
} from './profile.js'

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
    expect(profile.endpoint).toBe('https://sim.ai')
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

  it('strips a trailing slash so paths do not double up', () => {
    expect(resolveProfile({ endpoint: 'https://sim.ai///' }).endpoint).toBe('https://sim.ai')
  })

  it('ignores an unrecognized output format instead of failing the whole resolve', () => {
    process.env.SIM_OUTPUT = 'yaml'
    expect(resolveProfile().output).toBe('table')
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

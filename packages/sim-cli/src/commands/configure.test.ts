import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readConfigProfile, writeConfigProfile, writeCredentialsProfile } from '../config/index'
import { configureCommand } from './configure'

const mocks = vi.hoisted(() => ({ profileName: 'default' }))

vi.mock('../context', () => ({
  profileFrom: () => ({ name: mocks.profileName }),
}))

let dir: string

function run(...args: string[]): Promise<Command> {
  const root = new Command('sim').exitOverride()
  root.addCommand(configureCommand())
  return root.parseAsync(['node', 'sim', 'configure', ...args])
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sim-cli-'))
  process.env.SIM_CONFIG_DIR = dir
  mocks.profileName = 'default'
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
  process.env.SIM_CONFIG_DIR = undefined
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

  it('refuses to set an endpoint locally on a shared workspace profile', async () => {
    writeConfigProfile('default', { endpoint: 'https://sim.example' })
    writeCredentialsProfile('default', 'stored-key')
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

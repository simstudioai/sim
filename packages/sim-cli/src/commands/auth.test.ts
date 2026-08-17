import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  buildApprovalUrl: vi.fn(() => 'https://sim.ai/cli/auth?code=ABCD'),
  createAuthRequest: vi.fn(() => ({ pairing: 'ABCD', verifier: 'verifier' })),
  createInterface: vi.fn(),
  listProfiles: vi.fn<() => string[]>(() => []),
  readCredentialsProfile: vi.fn<() => Record<string, string>>(() => ({})),
  pollForKey: vi.fn(async () => ({
    apiKey: 'sim-key',
    scope: 'platform' as const,
    workspaceBound: false,
    workspaceId: 'ws_1' as string | undefined,
  })),
  profileFrom: vi.fn(() => ({
    name: 'default',
    endpoint: 'https://sim.ai',
    apiKey: null as string | null,
    workspaceId: null as string | null,
    output: 'table',
    sources: {
      endpoint: 'default',
      apiKey: 'unset',
      workspaceId: 'unset',
      output: 'default',
    },
  })),
  writeConfigProfile: vi.fn(),
  writeCredentialsProfile: vi.fn(),
}))

vi.mock('node:readline/promises', () => ({ createInterface: mocks.createInterface }))
vi.mock('../auth/device-flow', () => ({
  buildApprovalUrl: mocks.buildApprovalUrl,
  createAuthRequest: mocks.createAuthRequest,
  pollForKey: mocks.pollForKey,
}))
vi.mock('../config/index', () => ({
  credentialsPath: () => '/tmp/sim-credentials',
  deleteProfile: vi.fn(),
  listProfiles: mocks.listProfiles,
  readCredentialsProfile: mocks.readCredentialsProfile,
  writeConfigProfile: mocks.writeConfigProfile,
  writeCredentialsProfile: mocks.writeCredentialsProfile,
}))
vi.mock('../context', () => ({ profileFrom: mocks.profileFrom }))

import { loginCommand, profilesCommand, whoamiCommand } from './auth'

const originalIsTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')

function setInteractive(value: boolean): void {
  Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value })
}

async function login(...args: string[]): Promise<void> {
  const root = new Command('sim').exitOverride()
  root.addCommand(loginCommand())
  await root.parseAsync(['node', 'sim', 'login', '--no-browser', ...args])
}

async function whoami(...args: string[]): Promise<void> {
  const root = new Command('sim').exitOverride()
  root.addCommand(whoamiCommand())
  await root.parseAsync(['node', 'sim', 'whoami', ...args])
}

describe('login command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listProfiles.mockReturnValue([])
    mocks.readCredentialsProfile.mockReturnValue({})
    mocks.profileFrom.mockReturnValue({
      name: 'default',
      endpoint: 'https://sim.ai',
      apiKey: null,
      workspaceId: null,
      output: 'table',
      sources: {
        endpoint: 'default',
        apiKey: 'unset',
        workspaceId: 'unset',
        output: 'default',
      },
    })
    mocks.pollForKey.mockResolvedValue({
      apiKey: 'sim-key',
      scope: 'platform',
      workspaceBound: false,
      workspaceId: 'ws_1',
    })
    mocks.createInterface.mockReturnValue({
      question: vi.fn(async () => 'yes'),
      close: vi.fn(),
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    if (originalIsTTY) Object.defineProperty(process.stdin, 'isTTY', originalIsTTY)
    else Reflect.deleteProperty(process.stdin, 'isTTY')
  })

  it('does not prompt when the profile is new', async () => {
    setInteractive(false)
    await login()

    expect(mocks.createInterface).not.toHaveBeenCalled()
    expect(mocks.createAuthRequest).toHaveBeenCalledOnce()
  })

  it('requires --yes before overwriting non-interactively', async () => {
    setInteractive(false)
    mocks.readCredentialsProfile.mockReturnValue({ api_key: 'existing-key' })

    await expect(login()).rejects.toThrow(
      'Profile "default" already exists. Re-run with --yes to overwrite it.'
    )
    expect(mocks.createAuthRequest).not.toHaveBeenCalled()

    await login('--yes')
    expect(mocks.createAuthRequest).toHaveBeenCalledOnce()
  })

  it('continues only when an interactive overwrite is confirmed', async () => {
    setInteractive(true)
    mocks.readCredentialsProfile.mockReturnValue({ api_key: 'existing-key' })
    const question = vi.fn(async () => 'yes')
    const close = vi.fn()
    mocks.createInterface.mockReturnValue({ question, close })

    await login()

    expect(question).toHaveBeenCalledWith(
      'Profile "default" already exists. Replace its API key and login defaults? (y/N) '
    )
    expect(close).toHaveBeenCalledOnce()
    expect(mocks.createAuthRequest).toHaveBeenCalledOnce()
  })

  it('leaves the profile unchanged when confirmation is declined', async () => {
    setInteractive(true)
    mocks.readCredentialsProfile.mockReturnValue({ api_key: 'existing-key' })
    mocks.createInterface.mockReturnValue({
      question: vi.fn(async () => 'no'),
      close: vi.fn(),
    })

    await login()

    expect(mocks.createAuthRequest).not.toHaveBeenCalled()
    expect(mocks.writeCredentialsProfile).not.toHaveBeenCalled()
    expect(mocks.writeConfigProfile).not.toHaveBeenCalled()
  })

  it('does not prompt for a config-only or logged-out profile', async () => {
    setInteractive(false)
    mocks.listProfiles.mockReturnValue(['default'])
    mocks.readCredentialsProfile.mockReturnValue({})

    await login()

    expect(mocks.createInterface).not.toHaveBeenCalled()
    expect(mocks.createAuthRequest).toHaveBeenCalledOnce()
  })

  it('clears a stale workspace default when none is selected during login', async () => {
    setInteractive(false)
    mocks.profileFrom.mockReturnValue({
      name: 'default',
      endpoint: 'https://sim.ai',
      apiKey: null,
      workspaceId: 'ws_old',
      output: 'table',
      sources: {
        endpoint: 'default',
        apiKey: 'unset',
        workspaceId: 'config',
        output: 'default',
      },
    })
    mocks.pollForKey.mockResolvedValue({
      apiKey: 'sim-key',
      scope: 'platform',
      workspaceBound: false,
      workspaceId: undefined,
    })

    await login()

    expect(mocks.writeConfigProfile).toHaveBeenCalledWith('default', {
      endpoint: 'https://sim.ai',
      workspace: null,
    })
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('no default workspace'))
  })
})

describe('profiles command', () => {
  it('accepts the singular profile alias', () => {
    expect(profilesCommand().alias()).toBe('profile')
  })
})

describe('whoami command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('reports authentication without exposing any part of the API key', async () => {
    mocks.profileFrom.mockReturnValue({
      name: 'default',
      endpoint: 'https://sim.ai',
      apiKey: 'sim_super_secret_value',
      workspaceId: 'ws_1',
      output: 'text',
      sources: {
        endpoint: 'default',
        apiKey: 'credentials',
        workspaceId: 'config',
        output: 'flag',
      },
    })

    await whoami()

    const output = vi.mocked(console.log).mock.calls.flat().join('\n')
    expect(output).toContain('API key\tconfigured (credentials)')
    expect(output).not.toContain('sim_super_secret_value')
    expect(output).not.toContain('secret')
  })

  it('uses non-secret-shaped authentication metadata in machine output', async () => {
    mocks.profileFrom.mockReturnValue({
      name: 'default',
      endpoint: 'https://sim.ai',
      apiKey: 'sim_super_secret_value',
      workspaceId: 'ws_1',
      output: 'json',
      sources: {
        endpoint: 'default',
        apiKey: 'credentials',
        workspaceId: 'config',
        output: 'flag',
      },
    })

    await whoami()

    const output = String(vi.mocked(console.log).mock.calls[0][0])
    expect(JSON.parse(output)).toMatchObject({
      authenticated: true,
      sources: { authentication: 'credentials' },
    })
    expect(output).not.toContain('apiKey')
    expect(output).not.toContain('sim_super_secret_value')
  })
})

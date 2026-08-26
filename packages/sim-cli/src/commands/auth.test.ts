import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  buildApprovalUrl: vi.fn(() => 'https://sim.ai/cli/auth?code=ABCD'),
  createAuthRequest: vi.fn(() => ({ pairing: 'ABCD', verifier: 'verifier' })),
  createInterface: vi.fn(),
  deleteProfile: vi.fn(() => ({ config: false, credentials: false })),
  listAuthenticationDependents: vi.fn<() => string[]>(() => []),
  listProfiles: vi.fn<() => string[]>(() => []),
  request: vi.fn(),
  readCredentialsProfile: vi.fn<() => Record<string, string>>(() => ({})),
  ProfileConfigError: class ProfileConfigError extends Error {},
  resolveAuthenticationProfileName: vi.fn((profile: string) => profile),
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
/**
 * The two validators come from the real module rather than a copy: a duplicated
 * pattern here would keep passing if the shipped one were deleted, which is
 * exactly the regression these tests exist to catch. `../config/profile` is not
 * itself mocked, so this is the shipped implementation.
 */
vi.mock('../config/index', async () => ({
  ...(await import('../config/profile').then(({ normalizeWorkspaceId, validateProfileName }) => ({
    normalizeWorkspaceId,
    validateProfileName,
  }))),
  configPath: () => '/tmp/sim-config',
  credentialsPath: () => '/tmp/sim-credentials',
  DEFAULT_PROFILE: 'default',
  deleteProfile: mocks.deleteProfile,
  listAuthenticationDependents: mocks.listAuthenticationDependents,
  listProfiles: mocks.listProfiles,
  ProfileConfigError: mocks.ProfileConfigError,
  readCredentialsProfile: mocks.readCredentialsProfile,
  resolveAuthenticationProfileName: mocks.resolveAuthenticationProfileName,
  writeConfigProfile: mocks.writeConfigProfile,
  writeCredentialsProfile: mocks.writeCredentialsProfile,
}))
vi.mock('../context', () => ({
  globalsOf: (command: Command) => command.optsWithGlobals(),
  profileFrom: mocks.profileFrom,
  clientFrom: () => ({ client: { request: mocks.request }, profile: mocks.profileFrom() }),
}))

import { SimApiError } from '../http/client'
import { loginCommand, logoutCommand, profilesCommand, whoamiCommand } from './auth'

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

async function profiles(...args: string[]): Promise<void> {
  const root = new Command('sim')
    .exitOverride()
    .option('-P, --profile <name>')
    .option('-w, --workspace <id>')
  root.addCommand(profilesCommand())
  await root.parseAsync(['node', 'sim', 'profiles', ...args])
}

async function logout(...args: string[]): Promise<void> {
  const root = new Command('sim').exitOverride().option('-P, --profile <name>')
  root.addCommand(logoutCommand())
  await root.parseAsync(['node', 'sim', 'logout', ...args])
}

describe('login command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listProfiles.mockReturnValue([])
    mocks.readCredentialsProfile.mockReturnValue({})
    mocks.resolveAuthenticationProfileName.mockImplementation((profile) => profile)
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

  it('resolves a profile name that does not exist yet, because login creates it', async () => {
    // Resolution rejects an unknown --profile so a typo cannot silently talk to
    // production. `login` is one of the two commands exempt: it is how the
    // profile comes into existence.
    setInteractive(false)
    await login()

    expect(mocks.profileFrom).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ allowUnknownProfile: true })
    )
  })

  it('refuses to replace authentication through a shared workspace profile', async () => {
    setInteractive(false)
    mocks.profileFrom.mockReturnValue({
      name: 'acme',
      endpoint: 'https://sim.ai',
      apiKey: 'sim-key',
      workspaceId: 'ws_acme',
      output: 'table',
      sources: {
        endpoint: 'config',
        apiKey: 'credentials',
        workspaceId: 'config',
        output: 'default',
      },
    })
    mocks.resolveAuthenticationProfileName.mockReturnValue('default')

    await expect(login()).rejects.toThrow(
      'Profile "acme" shares authentication with "default". Run: sim login --profile default'
    )
    expect(mocks.createAuthRequest).not.toHaveBeenCalled()
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

  it('writes the endpoint before the key, so a failed write cannot strand one', async () => {
    // A key on disk with no endpoint beside it falls back to the default host
    // on the next command, which would send a self-hosted key elsewhere.
    setInteractive(false)
    const order: string[] = []
    mocks.writeConfigProfile.mockImplementation(() => {
      order.push('config')
    })
    mocks.writeCredentialsProfile.mockImplementation(() => {
      order.push('credentials')
    })

    await login()

    expect(order).toEqual(['config', 'credentials'])
  })

  it('stores nothing when the server answers with an unstorable workspace id', async () => {
    setInteractive(false)
    mocks.pollForKey.mockResolvedValue({
      apiKey: 'sim-key',
      scope: 'platform',
      workspaceBound: false,
      workspaceId: 'ws_1\nendpoint = http://elsewhere.invalid',
    })

    await expect(login()).rejects.toThrow('Invalid workspace id')

    expect(mocks.writeConfigProfile).not.toHaveBeenCalled()
    expect(mocks.writeCredentialsProfile).not.toHaveBeenCalled()
  })

  it('stores nothing when the server answers with a malformed key', async () => {
    setInteractive(false)
    mocks.pollForKey.mockResolvedValue({
      apiKey: '  ',
      scope: 'platform',
      workspaceBound: false,
      workspaceId: 'ws_1',
    })

    await expect(login()).rejects.toThrow('malformed API key')

    expect(mocks.writeConfigProfile).not.toHaveBeenCalled()
    expect(mocks.writeCredentialsProfile).not.toHaveBeenCalled()
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
  beforeEach(() => {
    vi.clearAllMocks()
    setInteractive(false)
    mocks.listProfiles.mockReturnValue([])
    mocks.readCredentialsProfile.mockReturnValue({ api_key: 'stored-key' })
    mocks.resolveAuthenticationProfileName.mockImplementation((profile) => profile)
    mocks.profileFrom.mockReturnValue({
      name: 'default',
      endpoint: 'https://sim.ai',
      apiKey: 'stored-key',
      workspaceId: 'ws_default',
      output: 'table',
      sources: {
        endpoint: 'config',
        apiKey: 'credentials',
        workspaceId: 'config',
        output: 'default',
      },
    })
    mocks.request.mockResolvedValue({
      data: { id: 'ws_acme', name: 'Acme', memberCount: 3 },
    })
    mocks.createInterface.mockReturnValue({
      question: vi.fn(async () => '1'),
      close: vi.fn(),
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    if (originalIsTTY) Object.defineProperty(process.stdin, 'isTTY', originalIsTTY)
    else Reflect.deleteProperty(process.stdin, 'isTTY')
  })

  it('accepts the singular profile alias', () => {
    expect(profilesCommand().alias()).toBe('profile')
  })

  it('keeps the existing bare profiles command as the list shortcut', async () => {
    mocks.listProfiles.mockReturnValue(['default'])

    await profiles()

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('default'))
  })

  it('adds a validated workspace profile using the active stored login', async () => {
    await profiles('add', 'acme', '--workspace', 'ws_acme')

    expect(mocks.request).toHaveBeenCalledWith('/api/v2/workspaces/ws_acme', { method: 'GET' })
    expect(mocks.writeConfigProfile).toHaveBeenCalledWith('acme', {
      auth_profile: 'default',
      workspace: 'ws_acme',
    })
    expect(mocks.writeCredentialsProfile).not.toHaveBeenCalled()
  })

  it('does not write a profile when the active key cannot reach the workspace', async () => {
    mocks.request.mockRejectedValue(new SimApiError('Workspace not found', 404))

    await expect(profiles('add', 'acme', '--workspace', 'ws_missing')).rejects.toThrow(
      'Workspace not found'
    )
    expect(mocks.writeConfigProfile).not.toHaveBeenCalled()
  })

  it('flattens an active workspace profile to its canonical authentication profile', async () => {
    mocks.profileFrom.mockReturnValue({
      name: 'engineering',
      endpoint: 'https://sim.ai',
      apiKey: 'stored-key',
      workspaceId: 'ws_engineering',
      output: 'table',
      sources: {
        endpoint: 'config',
        apiKey: 'credentials',
        workspaceId: 'config',
        output: 'default',
      },
    })
    mocks.resolveAuthenticationProfileName.mockReturnValue('corporate')

    await profiles('add', 'finance', '--workspace', 'ws_acme')

    expect(mocks.writeConfigProfile).toHaveBeenCalledWith('finance', {
      auth_profile: 'corporate',
      workspace: 'ws_acme',
    })
  })

  it('refuses to persist a profile from an environment-only key', async () => {
    mocks.profileFrom.mockReturnValue({
      name: 'default',
      endpoint: 'https://sim.ai',
      apiKey: 'environment-key',
      workspaceId: null,
      output: 'table',
      sources: {
        endpoint: 'default',
        apiKey: 'env',
        workspaceId: 'unset',
        output: 'default',
      },
    })

    await expect(profiles('add', 'acme', '--workspace', 'ws_acme')).rejects.toThrow(
      'the active API key is not stored'
    )
    expect(mocks.request).not.toHaveBeenCalled()
    expect(mocks.writeConfigProfile).not.toHaveBeenCalled()
  })

  it('refuses to persist a profile from an ephemeral endpoint override', async () => {
    mocks.profileFrom.mockReturnValue({
      name: 'default',
      endpoint: 'https://temporary.example',
      apiKey: 'stored-key',
      workspaceId: null,
      output: 'table',
      sources: {
        endpoint: 'env',
        apiKey: 'credentials',
        workspaceId: 'unset',
        output: 'default',
      },
    })

    await expect(profiles('add', 'acme', '--workspace', 'ws_acme')).rejects.toThrow(
      'the active endpoint comes from env'
    )
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it('requires an explicit workspace outside an interactive terminal', async () => {
    await expect(profiles('add', 'acme')).rejects.toThrow(
      'Pass --workspace <id> when creating a profile non-interactively.'
    )
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it('offers every accessible workspace in an interactive picker', async () => {
    setInteractive(true)
    const question = vi.fn(async () => '2')
    const close = vi.fn()
    mocks.createInterface.mockReturnValue({ question, close })
    mocks.request.mockResolvedValue({
      data: [
        { id: 'ws_acme', name: 'Acme' },
        { id: 'ws_beta', name: 'Beta' },
      ],
      nextCursor: null,
    })

    await profiles('add', 'beta')

    expect(mocks.request).toHaveBeenCalledWith('/api/v2/workspaces', {
      method: 'GET',
      query: { sortBy: 'name', sortOrder: 'asc', limit: 100, cursor: null },
    })
    expect(question).toHaveBeenCalledWith('Choose a workspace [1-2]: ')
    expect(close).toHaveBeenCalledOnce()
    expect(mocks.writeConfigProfile).toHaveBeenCalledWith('beta', {
      auth_profile: 'default',
      workspace: 'ws_beta',
    })
  })

  it('caps the interactive workspace roster before prompting', async () => {
    setInteractive(true)
    mocks.request.mockResolvedValue({
      data: Array.from({ length: 1001 }, (_, index) => ({
        id: `ws_${index}`,
        name: `Workspace ${index}`,
      })),
      nextCursor: null,
    })

    await expect(profiles('add', 'large')).rejects.toThrow(
      'more than 1000 workspaces, which is too many to show interactively'
    )
    expect(mocks.createInterface).not.toHaveBeenCalled()
    expect(mocks.writeConfigProfile).not.toHaveBeenCalled()
  })

  it('refuses a new profile name that would forge a config section', async () => {
    await expect(profiles('add', 'evil]\n[default', '--workspace', 'ws_acme')).rejects.toThrow(
      'Invalid profile name'
    )
    expect(mocks.writeConfigProfile).not.toHaveBeenCalled()
  })

  it('does not overwrite an existing profile', async () => {
    mocks.listProfiles.mockReturnValue(['acme'])

    await expect(profiles('add', 'acme', '--workspace', 'ws_acme')).rejects.toThrow(
      'Profile "acme" already exists.'
    )
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it('lists a shared profile as authenticated by its referenced profile', async () => {
    mocks.listProfiles.mockReturnValue(['acme', 'default'])
    mocks.resolveAuthenticationProfileName.mockImplementation((profile) =>
      profile === 'acme' ? 'default' : profile
    )

    await profiles('list')

    const output = vi.mocked(console.log).mock.calls.flat().join('\n')
    expect(output).toMatch(/acme\s+yes\s+default/)
  })

  it('refuses an unknown profile like every other command', async () => {
    // `profiles list --profile typo` used to exit 0 on a name that resolves to
    // nothing, alone among the commands, because it never resolved at all.
    mocks.listProfiles.mockReturnValue(['default'])
    mocks.profileFrom.mockImplementation(() => {
      throw new mocks.ProfileConfigError('Unknown profile "bogus".')
    })

    await expect(profiles('list', '--profile', 'bogus')).rejects.toThrow('Unknown profile "bogus".')
    expect(console.log).not.toHaveBeenCalled()
  })

  it('renders the listing in the resolved output format', async () => {
    mocks.listProfiles.mockReturnValue(['acme', 'default'])
    mocks.profileFrom.mockReturnValue({
      name: 'default',
      endpoint: 'https://sim.ai',
      apiKey: 'stored-key',
      workspaceId: 'ws_default',
      output: 'json',
      sources: {
        endpoint: 'config',
        apiKey: 'credentials',
        workspaceId: 'config',
        output: 'config',
      },
    })

    await profiles('list')

    const output = vi.mocked(console.log).mock.calls.flat().join('\n')
    expect(JSON.parse(output)).toEqual([
      { name: 'acme', active: false, hasKey: true, authProfile: 'acme', error: null },
      { name: 'default', active: true, hasKey: true, authProfile: 'default', error: null },
    ])
  })

  it('answers a machine format with an empty list rather than prose', async () => {
    mocks.listProfiles.mockReturnValue([])
    mocks.profileFrom.mockReturnValue({
      name: 'default',
      endpoint: 'https://sim.ai',
      apiKey: null,
      workspaceId: null,
      output: 'json',
      sources: {
        endpoint: 'default',
        apiKey: 'unset',
        workspaceId: 'unset',
        output: 'config',
      },
    })

    await profiles('list')

    expect(JSON.parse(vi.mocked(console.log).mock.calls.flat().join('\n'))).toEqual([])
  })

  it('marks a broken profile and still lists the rest', async () => {
    // `profiles` is the command someone runs *because* a profile is broken, and
    // one bad auth_profile used to abort the listing with nothing shown at all.
    mocks.listProfiles.mockReturnValue(['broken', 'default', 'dev'])
    mocks.resolveAuthenticationProfileName.mockImplementation((profile) => {
      if (profile === 'broken') {
        throw new mocks.ProfileConfigError(
          'Profile "broken" references missing auth_profile "gone".'
        )
      }
      return profile
    })

    await profiles('list')

    const output = vi.mocked(console.log).mock.calls.flat().join('\n')
    expect(output).toContain('references missing auth_profile "gone"')
    expect(output).toContain('default')
    expect(output).toContain('dev')
  })
})

describe('logout command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listAuthenticationDependents.mockReturnValue([])
    mocks.resolveAuthenticationProfileName.mockImplementation((profile) => profile)
    mocks.readCredentialsProfile.mockReturnValue({ api_key: 'stored-key' })
    mocks.profileFrom.mockReturnValue({
      name: 'acme',
      endpoint: 'https://sim.ai',
      apiKey: 'stored-key',
      workspaceId: 'ws_acme',
      output: 'table',
      sources: {
        endpoint: 'config',
        apiKey: 'credentials',
        workspaceId: 'config',
        output: 'default',
      },
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('does not remove a key through a shared workspace profile', async () => {
    mocks.resolveAuthenticationProfileName.mockReturnValue('default')

    await expect(logout()).rejects.toThrow(
      'Log out of the authentication profile instead: sim logout --profile default'
    )
    expect(mocks.writeCredentialsProfile).not.toHaveBeenCalled()
  })

  it('removes only the selected alias under --all', async () => {
    mocks.deleteProfile.mockReturnValue({ config: true, credentials: false })

    await logout('--all', '--profile', 'acme')

    expect(mocks.deleteProfile).toHaveBeenCalledWith('acme')
    expect(mocks.resolveAuthenticationProfileName).not.toHaveBeenCalled()
    expect(mocks.writeCredentialsProfile).not.toHaveBeenCalled()
  })

  it('refuses to remove an authentication profile while workspace profiles use it', async () => {
    mocks.listAuthenticationDependents.mockReturnValue(['acme', 'beta'])

    await expect(logout('--all', '--profile', 'default')).rejects.toThrow(
      'Cannot remove authentication profile "default" because it is used by: acme, beta.'
    )
    expect(mocks.deleteProfile).not.toHaveBeenCalled()
  })
})

describe('whoami command', () => {
  const originalExitCode = process.exitCode

  function configured(overrides: Partial<ReturnType<typeof mocks.profileFrom>> = {}) {
    return {
      name: 'default',
      endpoint: 'https://sim.ai',
      apiKey: 'sim_super_secret_value' as string | null,
      workspaceId: 'ws_1' as string | null,
      output: 'text',
      sources: {
        endpoint: 'default',
        apiKey: 'credentials',
        workspaceId: 'config',
        output: 'flag',
      },
      ...overrides,
    }
  }

  /** Answers `/api/v2/meta` and the workspace read separately, as the API does. */
  function respond(meta: unknown = { data: { keyType: 'personal' } }) {
    mocks.request.mockImplementation(async (path: string) =>
      path === '/api/v2/meta'
        ? meta
        : { data: { id: 'ws_1', name: "Waleed Latif's Workspace", memberCount: 3 } }
    )
  }

  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
    mocks.profileFrom.mockReturnValue(configured())
    respond()
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    process.exitCode = originalExitCode
  })

  it('reports authentication without exposing any part of the API key', async () => {
    await whoami()

    const output = vi.mocked(console.log).mock.calls.flat().join('\n')
    expect(output).toContain('API key\tconfigured (credentials)')
    expect(output).not.toContain('sim_super_secret_value')
    expect(output).not.toContain('secret')
  })

  it('uses non-secret-shaped authentication metadata in machine output', async () => {
    mocks.profileFrom.mockReturnValue(configured({ output: 'json' }))

    await whoami()

    const output = String(vi.mocked(console.log).mock.calls[0][0])
    expect(JSON.parse(output)).toMatchObject({
      authenticated: true,
      sources: { authentication: 'credentials' },
      verification: {
        status: 'verified',
        workspace: { id: 'ws_1', name: "Waleed Latif's Workspace", memberCount: 3 },
      },
    })
    expect(output).not.toContain('apiKey')
    expect(output).not.toContain('sim_super_secret_value')
  })

  it('checks the key against the API and names the workspace it reached', async () => {
    await whoami()

    expect(mocks.request).toHaveBeenCalledWith('/api/v2/workspaces/ws_1', { method: 'GET' })
    const output = vi.mocked(console.log).mock.calls.flat().join('\n')
    expect(output).toContain("Waleed Latif's Workspace")
    expect(output).toContain('3 members')
    expect(process.exitCode).toBeUndefined()
  })

  it('exits 1 when the API rejects the key, without hiding the resolved settings', async () => {
    mocks.request.mockRejectedValue(
      new SimApiError('Invalid API key — run: sim login --profile default', 401)
    )

    await whoami()

    const output = vi.mocked(console.log).mock.calls.flat().join('\n')
    expect(output).toContain('Endpoint\thttps://sim.ai')
    expect(output).toContain('Invalid API key')
    expect(process.exitCode).toBe(1)
  })

  it('exits 2 rather than blaming the key when the endpoint cannot be reached', async () => {
    mocks.request.mockRejectedValue(
      new SimApiError('Could not reach https://sim.ai: fetch failed', 0)
    )

    await whoami()

    const output = vi.mocked(console.log).mock.calls.flat().join('\n')
    expect(output).toContain('could not check — Could not reach https://sim.ai')
    expect(process.exitCode).toBe(2)
  })

  it('exits 2 rather than blaming the key when the API itself is down', async () => {
    // A 502 from a proxy mid-deploy said `✗ Bad Gateway` and exited 1, which
    // tells a script to run `sim login` for something logging in cannot fix.
    mocks.request.mockRejectedValue(new SimApiError('Bad Gateway', 502))

    await whoami()

    const output = vi.mocked(console.log).mock.calls.flat().join('\n')
    expect(output).toContain('could not check — Bad Gateway')
    expect(process.exitCode).toBe(2)
  })

  it('exits 2 when the endpoint answers something other than the API', async () => {
    // A wrong endpoint that serves a landing page comes back as a 200 the JSON
    // client could not parse; the key was never judged.
    mocks.request.mockRejectedValue(
      new SimApiError('https://sim.ai/api/v2/workspaces/ws_1 returned HTML, not JSON', 200)
    )

    await whoami()

    expect(process.exitCode).toBe(2)
  })

  it('exits 1 when the key cannot reach the configured workspace', async () => {
    mocks.request.mockRejectedValue(new SimApiError('Workspace not found', 404))

    await whoami()

    const output = vi.mocked(console.log).mock.calls.flat().join('\n')
    expect(output).toContain('Workspace not found')
    expect(process.exitCode).toBe(1)
  })

  it('exits 2 when no workspace is configured, because the check reads one', async () => {
    mocks.profileFrom.mockReturnValue(
      configured({ workspaceId: null, sources: { ...configured().sources, workspaceId: 'unset' } })
    )

    await whoami()

    // The key kind is still read: a profile with no workspace is exactly where
    // an unusable key most looks like a merely unconfigured one.
    expect(mocks.request).toHaveBeenCalledTimes(1)
    expect(mocks.request).toHaveBeenCalledWith('/api/v2/meta', { method: 'GET' })
    const output = vi.mocked(console.log).mock.calls.flat().join('\n')
    expect(output).toContain('no workspace to check against')
    expect(process.exitCode).toBe(2)
  })

  it('exits 1 when no key is configured', async () => {
    mocks.profileFrom.mockReturnValue(
      configured({ apiKey: null, sources: { ...configured().sources, apiKey: 'unset' } })
    )

    await whoami()

    expect(mocks.request).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('makes no request and stays offline under --no-verify', async () => {
    mocks.profileFrom.mockReturnValue(configured({ output: 'json' }))

    await whoami('--no-verify')

    expect(mocks.request).not.toHaveBeenCalled()
    expect(process.exitCode).toBeUndefined()
    expect(JSON.parse(String(vi.mocked(console.log).mock.calls[0][0]))).toMatchObject({
      verification: { status: 'disabled', workspace: null, keyType: null },
    })
  })

  it('reports which kind of key is in play, the diagnostic a green check hid', async () => {
    // Six agents blocked by PRINCIPAL_KIND_NOT_PERMITTED ran `whoami` and saw a
    // green ✓, because personal and workspace keys printed identically.
    for (const keyType of ['personal', 'workspace']) {
      vi.mocked(console.log).mockClear()
      respond({ data: { keyType } })

      await whoami()

      expect(mocks.request).toHaveBeenCalledWith('/api/v2/meta', { method: 'GET' })
      expect(vi.mocked(console.log).mock.calls.flat().join('\n')).toContain(`Key type\t${keyType}`)
    }
  })

  it('carries the key kind into machine output', async () => {
    mocks.profileFrom.mockReturnValue(configured({ output: 'json' }))
    respond({ data: { keyType: 'workspace' } })

    await whoami()

    expect(JSON.parse(String(vi.mocked(console.log).mock.calls[0][0]))).toMatchObject({
      verification: { status: 'verified', keyType: 'workspace' },
    })
  })

  it('does not let an unreadable key kind change the verdict or the exit code', async () => {
    mocks.request.mockImplementation(async (path: string) => {
      if (path === '/api/v2/meta') throw new SimApiError('Not Found', 404)
      return { data: { id: 'ws_1', name: 'Acme', memberCount: 1 } }
    })

    await whoami()

    const output = vi.mocked(console.log).mock.calls.flat().join('\n')
    expect(output).toContain('Key type\tunknown')
    expect(output).toContain('Acme')
    expect(process.exitCode).toBeUndefined()
  })
})

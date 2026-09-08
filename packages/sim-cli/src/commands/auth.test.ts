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
  readConfigProfile: vi.fn<() => Record<string, string>>(() => ({})),
  readCredentialsProfile: vi.fn<() => Record<string, string>>(() => ({})),
  discoverOAuthProvider: vi.fn(
    async () => 'unavailable' as 'available' | 'unavailable' | 'unreachable'
  ),
  isLikelyRemoteSession: vi.fn(() => false),
  requireSecureEndpoint: vi.fn(),
  loginWithBrowser: vi.fn(async () => ({
    accessToken: 'sim_oat_access',
    refreshToken: 'sim_ort_refresh',
    expiresAt: 1_800_000_000_000,
    scope: 'offline_access api:read api:write',
  })),
  revokeToken: vi.fn(async () => undefined),
  grantsWriteAccess: vi.fn((scope: string) => scope.split(' ').includes('api:write')),
  resolveAuthenticationProfileName: vi.fn((profile: string) => profile),
  withCredentialsLock: vi.fn((work: () => Promise<unknown>) => work()),
  pollForKey: vi.fn<
    () => Promise<{
      id?: string
      apiKey: string
      scope: 'platform' | 'copilot'
      workspaceBound?: boolean
      workspaceId?: string
    }>
  >(async () => ({
    id: 'key-id',
    apiKey: 'sim-key',
    scope: 'platform',
    workspaceBound: false,
    workspaceId: 'ws_1',
  })),
  profileFrom: vi.fn(() => ({
    name: 'default',
    endpoint: 'https://sim.ai',
    apiKey: null as string | null,
    workspaceId: null as string | null,
    output: 'table',
    sources: {
      endpoint: 'default',
      credential: 'unset',
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
 * Discovery answers "unavailable" unless a test says otherwise, so the suite
 * below keeps exercising the pairing-code handoff it was written against; the
 * OAuth-path tests flip it to "available".
 */
vi.mock('../auth/oauth-flow', () => ({
  discoverOAuthProvider: mocks.discoverOAuthProvider,
  isLikelyRemoteSession: mocks.isLikelyRemoteSession,
  requireSecureEndpoint: mocks.requireSecureEndpoint,
  loginWithBrowser: mocks.loginWithBrowser,
  revokeToken: mocks.revokeToken,
  grantsWriteAccess: mocks.grantsWriteAccess,
  OAUTH_SCOPES_FULL: ['offline_access', 'api:read', 'api:write'],
  OAUTH_SCOPES_READ_ONLY: ['offline_access', 'api:read'],
}))
/**
 * The validators and the format list come from the real module rather than a
 * copy: a duplicated pattern here would keep passing if the shipped one were
 * deleted, which is exactly the regression these tests exist to catch. `../config/profile` is not
 * itself mocked, so this is the shipped implementation.
 */
vi.mock('../config/index', async () => ({
  ...(await import('../config/profile').then(
    ({
      FORBIDDEN_IN_VALUE,
      normalizeWorkspaceId,
      OUTPUT_FORMATS,
      ProfileConfigError,
      validateProfileName,
    }) => ({
      FORBIDDEN_IN_VALUE,
      normalizeWorkspaceId,
      OUTPUT_FORMATS,
      ProfileConfigError,
      validateProfileName,
    })
  )),
  configPath: () => '/tmp/sim-config',
  credentialsPath: () => '/tmp/sim-credentials',
  DEFAULT_PROFILE: 'default',
  deleteProfile: mocks.deleteProfile,
  listAuthenticationDependents: mocks.listAuthenticationDependents,
  listProfiles: mocks.listProfiles,
  readCredentialsProfile: mocks.readCredentialsProfile,
  readConfigProfile: mocks.readConfigProfile,
  oauthIssuerForEndpoint: (endpoint: string) => `${endpoint}/api/auth`,
  /**
   * Derived from the section mock so a test that seeds `{ api_key }` or the
   * OAuth keys sees the same credential the shipped reader would.
   */
  readStoredCredential: () => {
    const section = mocks.readCredentialsProfile()
    if (section.access_token && section.refresh_token) {
      return {
        kind: 'oauth',
        oauth: {
          accessToken: section.access_token,
          refreshToken: section.refresh_token,
          expiresAt: Number(section.token_expires_at ?? 0),
          issuer: section.oauth_issuer ?? 'https://sim.ai/api/auth',
          loginId: section.oauth_login_id ?? 'login-1',
          scope: section.oauth_scope ?? 'offline_access api:read api:write',
        },
      }
    }
    return section.api_key ? { kind: 'api_key', apiKey: section.api_key } : null
  },
  resolveAuthenticationProfileName: mocks.resolveAuthenticationProfileName,
  writeConfigProfile: mocks.writeConfigProfile,
  writeCredentialsProfile: mocks.writeCredentialsProfile,
  /** The real lock is exercised in profile.test.ts; command tests preserve observable writes. */
  withCredentialsLock: mocks.withCredentialsLock,
  withProfileLoginLease: <T>(_profile: string, work: () => Promise<T>) => work(),
}))
vi.mock('../context', () => ({
  globalsOf: (command: Command) => command.optsWithGlobals(),
  profileFrom: mocks.profileFrom,
  clientFrom: () => ({ client: { request: mocks.request }, profile: mocks.profileFrom() }),
}))

import { ProfileConfigError, ProfileOverrideError } from '../config/profile'
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

beforeEach(() => {
  mocks.withCredentialsLock.mockImplementation((work) => work())
})

describe('login command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listProfiles.mockReturnValue([])
    mocks.readConfigProfile.mockReturnValue({})
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
        credential: 'unset',
        workspaceId: 'unset',
        output: 'default',
      },
    })
    mocks.pollForKey.mockResolvedValue({
      id: 'key-id',
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
        credential: 'credentials',
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
      'Profile "default" already exists. Replace its login and defaults? (y/N) '
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

  it('clears the previous key before changing its endpoint', async () => {
    setInteractive(false)
    const order: string[] = []
    mocks.writeConfigProfile.mockImplementation(() => {
      order.push('config')
    })
    mocks.writeCredentialsProfile.mockImplementation(() => {
      order.push('credentials')
    })

    await login()

    expect(order).toEqual(['credentials', 'config', 'credentials'])
  })

  it('restores settings and reports a minted handoff key when credential storage fails', async () => {
    setInteractive(false)
    mocks.writeCredentialsProfile
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw new Error('credentials disk full')
      })

    await expect(login()).rejects.toThrow('credentials disk full')

    expect(mocks.writeConfigProfile).toHaveBeenNthCalledWith(1, 'default', {
      endpoint: 'https://sim.ai',
      workspace: 'ws_1',
    })
    expect(mocks.writeConfigProfile).toHaveBeenNthCalledWith(2, 'default', {
      endpoint: null,
      workspace: null,
    })
    expect(mocks.writeCredentialsProfile).toHaveBeenLastCalledWith('default', null)
    expect(vi.mocked(console.log).mock.calls.flat().join('\n')).toContain(
      'API key key-id was created but could not be stored safely'
    )
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

    await expect(login()).rejects.toThrow('malformed credential')

    expect(mocks.writeConfigProfile).not.toHaveBeenCalled()
    expect(mocks.writeCredentialsProfile).not.toHaveBeenCalled()
  })

  it.each([
    ['a C0 control character', 'sim-key\u0001rest'],
    ['a Unicode line separator', 'sim-key\u2028rest'],
    ['leading whitespace', ' sim-key'],
    ['trailing whitespace', 'sim-key '],
  ])('stores nothing when the minted key carries %s', async (_label, apiKey) => {
    // The pre-write check has to refuse exactly what the writer refuses. When it
    // was the narrower of the two, the settings write landed and the credentials
    // write threw — leaving the new endpoint on disk beside the previous key.
    setInteractive(false)
    mocks.pollForKey.mockResolvedValue({
      apiKey,
      scope: 'platform',
      workspaceBound: false,
      workspaceId: 'ws_1',
    })

    await expect(login()).rejects.toThrow('malformed credential')

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
        credential: 'unset',
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

  it('refuses an empty workspace id instead of storing it as no workspace', async () => {
    setInteractive(false)
    mocks.profileFrom.mockReturnValue({
      name: 'default',
      endpoint: 'https://sim.ai',
      apiKey: null,
      workspaceId: 'ws_old',
      output: 'table',
      sources: {
        endpoint: 'default',
        credential: 'unset',
        workspaceId: 'config',
        output: 'default',
      },
    })
    mocks.pollForKey.mockResolvedValue({
      apiKey: 'sim-key',
      scope: 'platform',
      workspaceBound: false,
      workspaceId: '',
    })

    await expect(login()).rejects.toThrow('Empty workspace id from the login response.')
    expect(mocks.writeConfigProfile).not.toHaveBeenCalled()
    expect(mocks.writeCredentialsProfile).not.toHaveBeenCalled()
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
        credential: 'credentials',
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

  it('refuses to create a dangling alias when logout wins the credential lock', async () => {
    mocks.withCredentialsLock.mockImplementationOnce(async (work) => {
      mocks.readCredentialsProfile.mockReturnValue({})
      return work()
    })

    await expect(profiles('add', 'acme', '--workspace', 'ws_acme')).rejects.toThrow(
      'the active login is not stored'
    )

    expect(mocks.writeConfigProfile).not.toHaveBeenCalled()
  })

  it('refuses to bind a workspace selected with a credential replaced before commit', async () => {
    mocks.withCredentialsLock.mockImplementationOnce(async (work) => {
      mocks.readCredentialsProfile.mockReturnValue({ api_key: 'replacement-key' })
      return work()
    })

    await expect(profiles('add', 'acme', '--workspace', 'ws_acme')).rejects.toThrow(
      'changed while the workspace was being selected'
    )

    expect(mocks.writeConfigProfile).not.toHaveBeenCalled()
  })

  it('accepts a normal OAuth refresh while selecting the workspace', async () => {
    const initial = {
      access_token: 'sim_oat_initial',
      refresh_token: 'sim_ort_initial',
      token_expires_at: '1800000000000',
      oauth_issuer: 'https://sim.ai/api/auth',
      oauth_login_id: 'stable-login',
      oauth_scope: 'offline_access api:read api:write',
    }
    const refreshed = {
      ...initial,
      access_token: 'sim_oat_refreshed',
      refresh_token: 'sim_ort_refreshed',
      token_expires_at: '1800003600000',
    }
    mocks.readCredentialsProfile.mockReturnValue(initial)
    mocks.request.mockImplementationOnce(async () => {
      mocks.readCredentialsProfile.mockReturnValue(refreshed)
      return { data: { id: 'ws_acme', name: 'Acme', memberCount: 3 } }
    })

    await profiles('add', 'acme', '--workspace', 'ws_acme')

    expect(mocks.writeConfigProfile).toHaveBeenCalledWith('acme', {
      auth_profile: 'default',
      workspace: 'ws_acme',
    })
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
        credential: 'credentials',
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
        credential: 'env',
        workspaceId: 'unset',
        output: 'default',
      },
    })

    await expect(profiles('add', 'acme', '--workspace', 'ws_acme')).rejects.toThrow(
      'the active login is not stored'
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
        credential: 'credentials',
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

  it('refuses a workspace id the response could not have stored, naming the response', async () => {
    // The id comes off the wire exactly like the login response's, so it is
    // checked the same way. Without this the writer still refused it, but with
    // a message about the file format rather than the side that produced it.
    mocks.request.mockResolvedValue({
      data: { id: 'ws_acme\nendpoint = http://elsewhere.invalid', name: 'Acme', memberCount: 3 },
    })

    await expect(profiles('add', 'acme', '--workspace', 'ws_acme')).rejects.toThrow(
      'Invalid workspace id "ws_acme endpoint = http://elsewhere.invalid" from the workspace response.'
    )
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
      throw new ProfileConfigError('Unknown profile "bogus".')
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
        credential: 'credentials',
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
        credential: 'unset',
        workspaceId: 'unset',
        output: 'config',
      },
    })

    await profiles('list')

    expect(JSON.parse(vi.mocked(console.log).mock.calls.flat().join('\n'))).toEqual([])
  })

  it('lists a broken active profile instead of refusing to list at all', async () => {
    // Resolving the active profile supplies the row marker and the format, but
    // it throws for exactly the profile this command exists to show.
    mocks.listProfiles.mockReturnValue(['broken', 'default'])
    mocks.profileFrom.mockImplementation(() => {
      throw new ProfileConfigError('Profile "broken" references missing auth_profile "gone".')
    })
    mocks.resolveAuthenticationProfileName.mockImplementation((profile) => {
      if (profile === 'broken') {
        throw new ProfileConfigError('Profile "broken" references missing auth_profile "gone".')
      }
      return profile
    })

    await profiles('list', '--profile', 'broken')

    const output = vi.mocked(console.log).mock.calls.flat().join('\n')
    expect(output).toContain('broken')
    expect(output).toContain('default')
    expect(output).toContain('references missing auth_profile "gone"')
  })

  it('refuses an unknown profile named by the environment, not just the flag', async () => {
    // The same guard, reached through its other input. `SIM_PROFILE=typo sim
    // profiles` must fail exactly like `sim profiles --profile typo`.
    mocks.listProfiles.mockReturnValue(['default'])
    mocks.profileFrom.mockImplementation(() => {
      throw new ProfileConfigError('Unknown profile "bogus".')
    })
    process.env.SIM_PROFILE = 'bogus'

    try {
      await expect(profiles('list')).rejects.toThrow('Unknown profile "bogus".')
      expect(console.log).not.toHaveBeenCalled()
    } finally {
      Reflect.deleteProperty(process.env, 'SIM_PROFILE')
    }
  })

  it('refuses an output format it does not know rather than printing a table', async () => {
    // A script asking for a machine format must not be handed human output with
    // exit 0. The catch exists to tolerate a broken *profile*, not a bad flag.
    mocks.listProfiles.mockReturnValue(['default'])
    mocks.profileFrom.mockImplementation(() => {
      throw new ProfileConfigError('Unknown output format "jsonl" from env.')
    })
    process.env.SIM_OUTPUT = 'jsonl'

    try {
      await expect(profiles('list')).rejects.toThrow('Unknown output format "jsonl" from env.')
      expect(console.log).not.toHaveBeenCalled()
    } finally {
      Reflect.deleteProperty(process.env, 'SIM_OUTPUT')
    }
  })

  it('refuses a blank root flag rather than absorbing it into the broken-profile fallback', async () => {
    // The tolerance below exists for a profile that will not resolve. A blank
    // `--workspace` is the caller's own argument, and swallowing it listed
    // profiles and exited 0 where every other command exits 1.
    mocks.listProfiles.mockReturnValue(['default'])
    mocks.profileFrom.mockImplementation(() => {
      throw new ProfileOverrideError('--workspace requires a value.')
    })

    await expect(profiles('list', '--workspace', '')).rejects.toThrow(
      '--workspace requires a value.'
    )
    expect(console.log).not.toHaveBeenCalled()
  })

  it('marks a broken profile and still lists the rest', async () => {
    // `profiles` is the command someone runs *because* a profile is broken, and
    // one bad auth_profile used to abort the listing with nothing shown at all.
    mocks.listProfiles.mockReturnValue(['broken', 'default', 'dev'])
    mocks.resolveAuthenticationProfileName.mockImplementation((profile) => {
      if (profile === 'broken') {
        throw new ProfileConfigError('Profile "broken" references missing auth_profile "gone".')
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
        credential: 'credentials',
        workspaceId: 'config',
        output: 'default',
      },
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('does not remove a key through a shared workspace profile', async () => {
    mocks.resolveAuthenticationProfileName.mockReturnValue('default')

    await expect(logout('--profile', 'acme')).rejects.toThrow(
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

  it('rechecks dependents after taking the lock before removing an authentication profile', async () => {
    mocks.withCredentialsLock.mockImplementationOnce(async (work) => {
      mocks.listAuthenticationDependents.mockReturnValue(['acme'])
      return work()
    })

    await expect(logout('--all', '--profile', 'default')).rejects.toThrow(
      'Cannot remove authentication profile "default" because it is used by: acme.'
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
        credential: 'credentials',
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
    expect(output).toContain('Login\tAPI key (credentials)')
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
      configured({ apiKey: null, sources: { ...configured().sources, credential: 'unset' } })
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

describe('login command — OAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listProfiles.mockReturnValue([])
    mocks.readConfigProfile.mockReturnValue({})
    mocks.readCredentialsProfile.mockReturnValue({})
    mocks.resolveAuthenticationProfileName.mockImplementation((profile) => profile)
    mocks.discoverOAuthProvider.mockResolvedValue('available')
    mocks.isLikelyRemoteSession.mockReturnValue(false)
    mocks.pollForKey.mockResolvedValue({
      id: 'key-id',
      apiKey: 'sim-key',
      scope: 'platform',
      workspaceBound: false,
      workspaceId: 'ws_1',
    })
    mocks.profileFrom.mockReturnValue({
      name: 'default',
      endpoint: 'https://sim.ai',
      apiKey: null,
      workspaceId: null,
      output: 'table',
      sources: {
        endpoint: 'default',
        credential: 'unset',
        workspaceId: 'unset',
        output: 'default',
      },
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    if (originalIsTTY) Object.defineProperty(process.stdin, 'isTTY', originalIsTTY)
    else Reflect.deleteProperty(process.stdin, 'isTTY')
  })

  it('signs in through the browser by default and stores the login, not a key', async () => {
    setInteractive(false)
    await login()

    expect(mocks.loginWithBrowser).toHaveBeenCalledWith(
      'https://sim.ai',
      expect.objectContaining({
        scopes: ['offline_access', 'api:read', 'api:write'],
      })
    )
    expect(mocks.createAuthRequest).not.toHaveBeenCalled()
    expect(mocks.writeConfigProfile).toHaveBeenCalledWith('default', {
      endpoint: 'https://sim.ai',
    })
    expect(mocks.writeCredentialsProfile).toHaveBeenCalledWith('default', {
      kind: 'oauth',
      oauth: {
        accessToken: 'sim_oat_access',
        refreshToken: 'sim_ort_refresh',
        expiresAt: 1_800_000_000_000,
        issuer: 'https://sim.ai/api/auth',
        loginId: expect.any(String),
        scope: 'offline_access api:read api:write',
      },
    })
  })

  it('keeps a concurrently stored login and revokes the family it could not commit', async () => {
    setInteractive(false)
    mocks.readCredentialsProfile
      .mockReturnValueOnce({})
      .mockReturnValueOnce({})
      .mockReturnValueOnce({
        access_token: 'sim_oat_newer',
        refresh_token: 'sim_ort_newer',
        token_expires_at: '1800000000001',
        oauth_issuer: 'https://sim.ai/api/auth',
        oauth_login_id: 'newer-login',
        oauth_scope: 'offline_access api:read',
      })

    await expect(login()).rejects.toThrow('changed while sign-in was open')
    expect(mocks.writeCredentialsProfile).not.toHaveBeenCalled()
    expect(mocks.revokeToken).toHaveBeenCalledWith('https://sim.ai', 'sim_ort_refresh')
  })

  it('keeps a concurrently added authentication-profile link', async () => {
    setInteractive(false)
    mocks.readConfigProfile
      .mockReturnValueOnce({})
      .mockReturnValueOnce({})
      .mockReturnValueOnce({ auth_profile: 'default' })

    await expect(login()).rejects.toThrow('changed while sign-in was open')

    expect(mocks.writeCredentialsProfile).not.toHaveBeenCalled()
    expect(mocks.writeConfigProfile).not.toHaveBeenCalled()
    expect(mocks.revokeToken).toHaveBeenCalledWith('https://sim.ai', 'sim_ort_refresh')
  })

  it('best-effort revokes a newly issued family when local persistence fails', async () => {
    setInteractive(false)
    mocks.writeCredentialsProfile.mockImplementationOnce(() => {
      throw new Error('disk full')
    })

    await expect(login()).rejects.toThrow('disk full')
    expect(mocks.revokeToken).toHaveBeenCalledWith('https://sim.ai', 'sim_ort_refresh')
    expect(mocks.writeConfigProfile).not.toHaveBeenCalled()
  })

  it('clears the previous credential before changing its endpoint', async () => {
    setInteractive(false)
    mocks.readCredentialsProfile.mockReturnValue({ api_key: 'previous-key' })
    const order: string[] = []
    mocks.writeConfigProfile.mockImplementation(() => {
      order.push('config')
    })
    mocks.writeCredentialsProfile.mockImplementation((_profile, credential) => {
      order.push(credential ? 'credential' : 'clear')
    })

    await login('--yes')

    expect(order).toEqual(['clear', 'config', 'credential'])
  })

  it('restores the previous credential when endpoint persistence fails', async () => {
    setInteractive(false)
    mocks.readCredentialsProfile.mockReturnValue({ api_key: 'previous-key' })
    mocks.writeConfigProfile.mockImplementationOnce(() => {
      throw new Error('config disk full')
    })

    await expect(login('--yes')).rejects.toThrow('config disk full')

    expect(mocks.writeCredentialsProfile).toHaveBeenNthCalledWith(1, 'default', null)
    expect(mocks.writeCredentialsProfile).toHaveBeenNthCalledWith(2, 'default', {
      kind: 'api_key',
      apiKey: 'previous-key',
    })
    expect(mocks.writeConfigProfile).toHaveBeenNthCalledWith(2, 'default', { endpoint: null })
    expect(mocks.revokeToken).toHaveBeenCalledWith('https://sim.ai', 'sim_ort_refresh')
  })

  it('restores the previous endpoint and credential when OAuth storage fails', async () => {
    setInteractive(false)
    mocks.readConfigProfile.mockReturnValue({ endpoint: 'https://old.example' })
    mocks.readCredentialsProfile.mockReturnValue({ api_key: 'previous-key' })
    mocks.writeCredentialsProfile
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw new Error('credentials disk full')
      })

    await expect(login('--yes')).rejects.toThrow('credentials disk full')

    expect(mocks.writeConfigProfile).toHaveBeenNthCalledWith(1, 'default', {
      endpoint: 'https://sim.ai',
    })
    expect(mocks.writeConfigProfile).toHaveBeenNthCalledWith(2, 'default', {
      endpoint: 'https://old.example',
    })
    expect(mocks.writeCredentialsProfile).toHaveBeenLastCalledWith('default', {
      kind: 'api_key',
      apiKey: 'previous-key',
    })
    expect(mocks.revokeToken).toHaveBeenCalledWith('https://sim.ai', 'sim_ort_refresh')
  })

  it('asks only for the read scope under --read-only', async () => {
    setInteractive(false)
    await login('--read-only')

    expect(mocks.loginWithBrowser).toHaveBeenCalledWith(
      'https://sim.ai',
      expect.objectContaining({
        scopes: ['offline_access', 'api:read'],
      })
    )
  })

  it('pins the loopback port when asked, and refuses an unusable one', async () => {
    setInteractive(false)
    await login('--callback-port', '8976')
    expect(mocks.loginWithBrowser).toHaveBeenCalledWith(
      'https://sim.ai',
      expect.objectContaining({ callbackPort: 8976 })
    )

    await expect(login('--callback-port', '70000')).rejects.toThrow('Invalid --callback-port')
  })

  it('creates an API key without OAuth discovery when that method is selected', async () => {
    setInteractive(false)
    await login('--method', 'api-key')

    expect(mocks.loginWithBrowser).not.toHaveBeenCalled()
    expect(mocks.discoverOAuthProvider).not.toHaveBeenCalled()
    expect(mocks.pollForKey).toHaveBeenCalledOnce()
    expect(mocks.writeCredentialsProfile).toHaveBeenCalledWith('default', {
      kind: 'api_key',
      apiKey: 'sim-key',
    })
  })

  it.each([false, true])('honors explicit OAuth with remote detection %s', async (remote) => {
    setInteractive(false)
    mocks.isLikelyRemoteSession.mockReturnValue(remote)

    await login('--method', 'oauth')

    expect(mocks.loginWithBrowser).toHaveBeenCalledOnce()
    expect(mocks.pollForKey).not.toHaveBeenCalled()
  })

  it.each([false, true])(
    'refuses unavailable explicit OAuth with remote detection %s without minting a key',
    async (remote) => {
      setInteractive(false)
      mocks.isLikelyRemoteSession.mockReturnValue(remote)
      mocks.discoverOAuthProvider.mockResolvedValue('unavailable')

      await expect(login('--method', 'oauth')).rejects.toThrow('does not offer OAuth sign-in')

      expect(mocks.loginWithBrowser).not.toHaveBeenCalled()
      expect(mocks.createAuthRequest).not.toHaveBeenCalled()
      expect(mocks.pollForKey).not.toHaveBeenCalled()
      expect(mocks.writeCredentialsProfile).not.toHaveBeenCalled()
    }
  )

  it.each([
    { args: ['--read-only'], message: 'API-key login cannot issue a read-only login' },
    {
      args: ['--callback-port', '8976'],
      message: 'API-key login has no local callback',
    },
  ])('rejects OAuth-only options for API-key login: $args', async ({ args, message }) => {
    setInteractive(false)

    await expect(login('--method', 'api-key', ...args)).rejects.toThrow(message)

    expect(mocks.discoverOAuthProvider).not.toHaveBeenCalled()
    expect(mocks.loginWithBrowser).not.toHaveBeenCalled()
    expect(mocks.pollForKey).not.toHaveBeenCalled()
    expect(mocks.writeCredentialsProfile).not.toHaveBeenCalled()
  })

  it.each([
    { args: ['--method', 'password'], code: 'commander.invalidArgument' },
    { args: ['--method'], code: 'commander.optionMissingArgument' },
    { args: ['--browserless'], code: 'commander.unknownOption' },
    { args: ['--scope', 'copilot'], code: 'commander.unknownOption' },
    { args: ['--scope', 'platform'], code: 'commander.unknownOption' },
  ])('rejects invalid login options before authentication: $args', async ({ args, code }) => {
    const command = loginCommand()
      .exitOverride()
      .configureOutput({ writeErr: () => {} })

    await expect(command.parseAsync(args, { from: 'user' })).rejects.toMatchObject({ code })

    expect(mocks.profileFrom).not.toHaveBeenCalled()
    expect(mocks.loginWithBrowser).not.toHaveBeenCalled()
    expect(mocks.pollForKey).not.toHaveBeenCalled()
  })

  it('falls back to the pairing code in a remote session', async () => {
    setInteractive(false)
    mocks.isLikelyRemoteSession.mockReturnValue(true)
    await login()

    expect(mocks.loginWithBrowser).not.toHaveBeenCalled()
    expect(mocks.pollForKey).toHaveBeenCalledOnce()
  })

  it.each([{ args: [] }, { args: ['--method', 'api-key'] }])(
    'refuses to store a copilot key returned by the server with method args $args',
    async ({ args }) => {
      setInteractive(false)
      mocks.discoverOAuthProvider.mockResolvedValue('unavailable')
      mocks.pollForKey.mockResolvedValue({
        apiKey: 'sim-key',
        scope: 'copilot',
        workspaceBound: false,
        workspaceId: undefined,
      })
      await expect(login(...args)).rejects.toThrow('the CLI requires a platform API key')

      expect(mocks.loginWithBrowser).not.toHaveBeenCalled()
      expect(mocks.pollForKey).toHaveBeenCalledOnce()
      expect(mocks.writeCredentialsProfile).not.toHaveBeenCalled()
      expect(mocks.writeConfigProfile).not.toHaveBeenCalled()
    }
  )

  it.each([{ args: [] }, { args: ['--method', 'oauth'] }])(
    'refuses an unreachable endpoint with method args $args without minting a key',
    async ({ args }) => {
      setInteractive(false)
      mocks.discoverOAuthProvider.mockResolvedValue('unreachable')

      await expect(login(...args)).rejects.toThrow('Could not reach https://sim.ai')
      expect(mocks.pollForKey).not.toHaveBeenCalled()
    }
  )

  it('requires logout before replacing a stored OAuth login', async () => {
    setInteractive(false)
    mocks.readCredentialsProfile.mockReturnValue({
      access_token: 'a',
      refresh_token: 'r',
      token_expires_at: '1',
    })

    await expect(login()).rejects.toThrow('Run sim logout --profile default')
    await expect(login('--yes')).rejects.toThrow('Run sim logout --profile default')
    expect(mocks.loginWithBrowser).not.toHaveBeenCalled()
    expect(mocks.pollForKey).not.toHaveBeenCalled()
  })
})

describe('logout command — OAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listAuthenticationDependents.mockReturnValue([])
    mocks.resolveAuthenticationProfileName.mockImplementation((profile) => profile)
    mocks.readCredentialsProfile.mockReturnValue({
      access_token: 'sim_oat_a',
      refresh_token: 'sim_ort_r',
      token_expires_at: '1',
    })
    mocks.profileFrom.mockReturnValue({
      name: 'acme',
      endpoint: 'https://sim.ai',
      apiKey: null,
      workspaceId: 'ws_acme',
      output: 'table',
      sources: {
        endpoint: 'config',
        credential: 'credentials',
        workspaceId: 'config',
        output: 'default',
      },
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('revokes the refresh token on the server before forgetting it', async () => {
    const order: string[] = []
    mocks.revokeToken.mockImplementation(async () => {
      order.push('revoke')
    })
    mocks.writeCredentialsProfile.mockImplementation(() => {
      order.push('clear')
    })

    await logout('--profile', 'acme')

    expect(mocks.revokeToken).toHaveBeenCalledWith('https://sim.ai', 'sim_ort_r')
    expect(order).toEqual(['revoke', 'clear'])
    expect(mocks.writeCredentialsProfile).toHaveBeenCalledWith('acme', null)
  })

  it('still clears the machine when the server cannot be reached, and says so', async () => {
    mocks.revokeToken.mockRejectedValue(new Error('ECONNREFUSED'))

    await logout('--profile', 'acme')

    expect(mocks.writeCredentialsProfile).toHaveBeenCalledWith('acme', null)
    const output = vi.mocked(console.log).mock.calls.flat().join('\n')
    expect(output).toContain('Could not revoke the login')
  })

  it('revokes against the stored issuer even when the configured endpoint changed', async () => {
    mocks.readCredentialsProfile.mockReturnValue({
      access_token: 'sim_oat_a',
      refresh_token: 'sim_ort_r',
      token_expires_at: '1',
      oauth_issuer: 'https://original.example/api/auth',
      oauth_login_id: 'login-1',
      oauth_scope: 'offline_access api:read',
    })
    mocks.profileFrom.mockImplementation(() => {
      throw new ProfileConfigError('issuer mismatch')
    })

    await logout('--profile', 'acme')

    expect(mocks.profileFrom).not.toHaveBeenCalled()
    expect(mocks.revokeToken).toHaveBeenCalledWith('https://original.example', 'sim_ort_r')
    expect(mocks.writeCredentialsProfile).toHaveBeenCalledWith('acme', null)
  })

  it('does not contact or print credentials embedded in a hand-edited issuer', async () => {
    mocks.readCredentialsProfile.mockReturnValue({
      access_token: 'sim_oat_a',
      refresh_token: 'sim_ort_r',
      token_expires_at: '1',
      oauth_issuer: 'https://user:password@example.com/api/auth',
      oauth_login_id: 'login-1',
      oauth_scope: 'offline_access api:read',
    })

    await logout('--profile', 'acme')

    expect(mocks.revokeToken).not.toHaveBeenCalled()
    const output = vi.mocked(console.log).mock.calls.flat().join('\n')
    expect(output).not.toContain('user')
    expect(output).not.toContain('password')
    expect(output).toContain('https://example.com/api/auth')
  })

  it('removes terminal controls from an invalid stored issuer error', async () => {
    mocks.readCredentialsProfile.mockReturnValue({
      access_token: 'sim_oat_a',
      refresh_token: 'sim_ort_r',
      token_expires_at: '1',
      oauth_issuer: 'bad\u001b[31m-issuer',
      oauth_login_id: 'login-1',
      oauth_scope: 'offline_access api:read',
    })

    await logout('--profile', 'acme')

    expect(vi.mocked(console.log).mock.calls.flat().join('\n')).not.toContain('\u001b')
  })
})

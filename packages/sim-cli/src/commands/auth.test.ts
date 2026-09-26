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

  it('does not write a profile when the active key cannot reach the workspace', async () => {
    mocks.request.mockRejectedValue(new SimApiError('Workspace not found', 404))

    await expect(profiles('add', 'acme', '--workspace', 'ws_missing')).rejects.toThrow(
      'Workspace not found'
    )
    expect(mocks.writeConfigProfile).not.toHaveBeenCalled()
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

  it('refuses a new profile name that would forge a config section', async () => {
    await expect(profiles('add', 'evil]\n[default', '--workspace', 'ws_acme')).rejects.toThrow(
      'Invalid profile name'
    )
    expect(mocks.writeConfigProfile).not.toHaveBeenCalled()
  })
})

describe('logout command', () => {
  beforeEach(() => {
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
})

describe('login command — OAuth', () => {
  beforeEach(() => {
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

  it('best-effort revokes a newly issued family when local persistence fails', async () => {
    setInteractive(false)
    mocks.writeCredentialsProfile.mockImplementationOnce(() => {
      throw new Error('disk full')
    })

    await expect(login()).rejects.toThrow('disk full')
    expect(mocks.revokeToken).toHaveBeenCalledWith('https://sim.ai', 'sim_ort_refresh')
    expect(mocks.writeConfigProfile).not.toHaveBeenCalled()
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
})

import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createInterface } from 'node:readline/promises'
import { getErrorMessage } from '@sim/utils/errors'
import chalk from 'chalk'
import { Command, Option } from 'commander'
import { buildApprovalUrl, createAuthRequest, pollForKey } from '../auth/device-flow'
import {
  discoverOAuthProvider,
  grantsWriteAccess,
  isLikelyRemoteSession,
  loginWithBrowser,
  OAUTH_SCOPES_FULL,
  OAUTH_SCOPES_READ_ONLY,
  requireSecureEndpoint,
  revokeToken,
} from '../auth/oauth-flow'
import {
  configPath,
  credentialsPath,
  DEFAULT_PROFILE,
  deleteProfile,
  FORBIDDEN_IN_VALUE,
  listAuthenticationDependents,
  listProfiles,
  normalizeWorkspaceId,
  OUTPUT_FORMATS,
  type OutputFormat,
  oauthIssuerForEndpoint,
  ProfileConfigError,
  type ResolvedProfile,
  readConfigProfile,
  readStoredCredential,
  resolveAuthenticationProfileName,
  type SettingSource,
  type StoredCredential,
  type StoredOAuthCredential,
  validateProfileName,
  withCredentialsLock,
  withProfileLoginLease,
  writeConfigProfile,
  writeCredentialsProfile,
} from '../config/index'
import { ProfileOverrideError, redact } from '../config/profile'
import { clientFrom, globalsOf, profileFrom } from '../context'
import {
  type GetMetaResponse,
  type GetWorkspaceResponse,
  type ListWorkspacesResponse,
  V2_OPERATIONS,
} from '../generated/v2-api'
import { requestAllPages, resolvePath, SimApiError, type SimClient } from '../http/client'
import { type Column, printList, printRecord, safeOneLine, text } from '../output/render'

type SelectableWorkspace = ListWorkspacesResponse['data'][number]

const MAX_INTERACTIVE_WORKSPACES = 1000

/**
 * Best-effort browser launch. Failure is not an error: the URL is always printed
 * first, so a headless box, an SSH session, or a machine with no handler just
 * falls through to the user pasting it somewhere.
 */
function openBrowser(url: string): void {
  /**
   * Windows needs `cmd /c start "" <url>`.
   *
   * `start` is a cmd builtin, so it needs a shell — but its first quoted
   * argument is the *window title*, and node quotes the URL because of the `?`
   * and `&` in the query. Passing the URL alone therefore opens a console
   * titled with the handoff link and no browser at all. The empty `""` takes
   * the title slot so the URL lands where it belongs.
   */
  const [command, args] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : [process.platform === 'darwin' ? 'open' : 'xdg-open', [url]]

  try {
    const child = spawn(command, args, { stdio: 'ignore', detached: true })
    child.on('error', () => {})
    child.unref()
  } catch {}
}

function presentAuthentication(source: SettingSource): {
  authenticated: boolean
  source: SettingSource
} {
  switch (source) {
    case 'flag':
      return { authenticated: true, source: 'flag' }
    case 'env':
      return { authenticated: true, source: 'env' }
    case 'credentials':
      return { authenticated: true, source: 'credentials' }
    case 'unset':
      return { authenticated: false, source: 'unset' }
    case 'config':
    case 'default':
      throw new SimApiError(`Unexpected credential source "${source}".`, 0)
  }
}

async function confirmProfileOverwrite(profileName: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    throw new SimApiError(
      `Profile "${redact(profileName)}" already exists. Re-run with --yes to overwrite it.`,
      0
    )
  }

  const prompt = createInterface({ input: process.stdin, output: process.stderr })
  try {
    const answer = await prompt.question(
      `Profile "${redact(profileName)}" already exists. Replace its login and defaults? (y/N) `
    )
    return answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes'
  } finally {
    prompt.close()
  }
}

function selectedProfileName(command: Command): string {
  return globalsOf(command).profile || process.env.SIM_PROFILE || DEFAULT_PROFILE
}

function validateNewProfileName(profileName: string): void {
  // The shape rule lives with the config writer, so `profiles add`, `login
  // --profile`, and `configure --profile` cannot drift into three answers.
  validateProfileName(profileName)
  if (listProfiles().includes(profileName)) {
    throw new SimApiError(
      `Profile "${redact(profileName)}" already exists. Remove it first with: sim logout --all --profile ${redact(profileName)}`,
      0
    )
  }
}

/**
 * Refuses a minted credential the credentials file could not represent.
 *
 * The response is remote input, and the deployment answering it is
 * whatever the endpoint names. A value carrying a line break would be written
 * verbatim into an escape-less format, so the writer refuses it — this refuses
 * it one step earlier, before anything is on disk, and says which side is wrong.
 *
 * It shares {@link FORBIDDEN_IN_VALUE} with the writer rather than copying it:
 * a second spelling drifted once already, and a key this check accepted but the
 * writer rejected stranded the new endpoint beside the previous key. Surrounding
 * whitespace is the same failure and is refused here for the same reason — the
 * writer will not store text it cannot read back unchanged.
 *
 * Refused rather than trimmed: a minted key is opaque, so the CLI cannot tell
 * padding from the credential. Trimming would store a value the server never
 * issued and turn a loud, explained failure into a 401 on every later command.
 */
function requireStorableCredential(value: unknown): void {
  if (
    typeof value !== 'string' ||
    !value ||
    value !== value.trim() ||
    FORBIDDEN_IN_VALUE.test(value)
  ) {
    throw new SimApiError(
      'The server returned a malformed credential. Nothing was stored; check the endpoint.',
      0
    )
  }
}

/** Compares the credential snapshot taken before an interactive login began. */
function sameStoredCredential(
  current: StoredCredential | null,
  expected: StoredCredential | null
): boolean {
  if (!current || !expected) return current === expected
  if (current.kind !== expected.kind) return false
  if (current.kind === 'api_key' && expected.kind === 'api_key') {
    return current.apiKey === expected.apiKey
  }
  if (current.kind !== 'oauth' || expected.kind !== 'oauth') return false
  return (
    current.oauth.accessToken === expected.oauth.accessToken &&
    current.oauth.refreshToken === expected.oauth.refreshToken &&
    current.oauth.expiresAt === expected.oauth.expiresAt &&
    current.oauth.issuer === expected.oauth.issuer &&
    current.oauth.loginId === expected.oauth.loginId &&
    current.oauth.scope === expected.oauth.scope
  )
}

/** Whether two snapshots identify the same stored login across a normal OAuth refresh. */
function sameStoredAuthentication(
  current: StoredCredential | null,
  expected: StoredCredential | null
): boolean {
  if (current?.kind === 'oauth' && expected?.kind === 'oauth') {
    return (
      current.oauth.loginId === expected.oauth.loginId &&
      current.oauth.issuer === expected.oauth.issuer
    )
  }
  return sameStoredCredential(current, expected)
}

interface LoginProfileSnapshot {
  credential: StoredCredential | null
  authProfile: string | null
  endpoint: string | null
  workspace: string | null
}

function readLoginProfileSnapshot(profileName: string): LoginProfileSnapshot {
  const config = readConfigProfile(profileName)
  return {
    credential: readStoredCredential(profileName),
    authProfile: config.auth_profile ?? null,
    endpoint: config.endpoint ?? null,
    workspace: config.workspace ?? null,
  }
}

function sameLoginProfileSnapshot(
  current: LoginProfileSnapshot,
  expected: LoginProfileSnapshot
): boolean {
  return (
    sameStoredCredential(current.credential, expected.credential) &&
    current.authProfile === expected.authProfile &&
    current.endpoint === expected.endpoint &&
    current.workspace === expected.workspace
  )
}

function assertLoginProfileUnchanged(profileName: string, expected: LoginProfileSnapshot): void {
  if (!sameLoginProfileSnapshot(readLoginProfileSnapshot(profileName), expected)) {
    throw new SimApiError(
      `Profile "${redact(profileName)}" changed while sign-in was open. Its newer settings and login were kept.`,
      0
    )
  }
}

function requireStoredAuthentication(profile: ResolvedProfile): string {
  const authProfile = resolveAuthenticationProfileName(profile.name)
  if (profile.sources.credential !== 'credentials' || !readStoredCredential(authProfile)) {
    throw new SimApiError(
      `Cannot create a shared profile from "${redact(profile.name)}": the active login is not stored. Run: sim login --profile ${redact(authProfile)}`,
      0
    )
  }
  if (profile.sources.endpoint === 'flag' || profile.sources.endpoint === 'env') {
    throw new SimApiError(
      `Cannot create a shared profile from "${redact(profile.name)}": the active endpoint comes from ${profile.sources.endpoint}. Save it with: sim configure --profile ${redact(authProfile)} --set-endpoint ${profile.endpoint}`,
      0
    )
  }
  return authProfile
}

async function getWorkspaceById(
  client: Pick<SimClient, 'request'>,
  workspaceId: string
): Promise<SelectableWorkspace> {
  const operation = V2_OPERATIONS.getWorkspace
  const response = await client.request<GetWorkspaceResponse>(
    resolvePath(operation.path, { workspaceId }),
    { method: operation.method }
  )
  return response.data
}

async function chooseWorkspace(client: Pick<SimClient, 'request'>): Promise<SelectableWorkspace> {
  if (!process.stdin.isTTY) {
    throw new SimApiError(
      'No workspace provided. Pass --workspace <id> when creating a profile non-interactively.',
      0
    )
  }

  const operation = V2_OPERATIONS.listWorkspaces
  const workspaces = await requestAllPages<SelectableWorkspace>(client, operation.path, {
    method: operation.method,
    query: { sortBy: 'name', sortOrder: 'asc' },
    pageSize: 100,
    limit: MAX_INTERACTIVE_WORKSPACES + 1,
  })
  if (workspaces.length === 0) {
    throw new SimApiError('The active credential cannot access any workspaces.', 0)
  }
  if (workspaces.length > MAX_INTERACTIVE_WORKSPACES) {
    throw new SimApiError(
      `The active credential can access more than ${MAX_INTERACTIVE_WORKSPACES} workspaces, which is too many to show interactively. Pass --workspace <id> instead.`,
      0
    )
  }

  console.log('\nAvailable workspaces:')
  for (const [index, workspace] of workspaces.entries()) {
    console.log(`  ${index + 1}) ${safeOneLine(workspace.name)} (${workspace.id})`)
  }

  const prompt = createInterface({ input: process.stdin, output: process.stderr })
  try {
    const answer = await prompt.question(`Choose a workspace [1-${workspaces.length}]: `)
    const selected = Number(answer.trim())
    if (!Number.isInteger(selected) || selected < 1 || selected > workspaces.length) {
      throw new SimApiError(
        `Invalid workspace selection "${safeOneLine(answer)}". Choose a number from 1 to ${workspaces.length}.`,
        0
      )
    }
    return workspaces[selected - 1]
  } finally {
    prompt.close()
  }
}

function addProfileCommand(): Command {
  return new Command('add')
    .description('Add a workspace profile that shares the active stored login')
    .argument('<name>', 'Name for the new profile')
    .option('-w, --workspace <id>', 'Existing workspace to use; omit for an interactive picker')
    .action(async (profileName: string, _options: unknown, command: Command) => {
      validateNewProfileName(profileName)

      const { client, profile } = clientFrom(command)
      const authProfile = requireStoredAuthentication(profile)
      const credential = readStoredCredential(authProfile)
      const workspaceId = globalsOf(command).workspace
      const workspace = workspaceId
        ? await getWorkspaceById(client, workspaceId)
        : await chooseWorkspace(client)
      const normalizedWorkspaceId = normalizeWorkspaceId(workspace.id, 'the workspace response')

      await withCredentialsLock(async () => {
        validateNewProfileName(profileName)
        const currentProfile = profileFrom(command)
        const currentAuthProfile = requireStoredAuthentication(currentProfile)
        if (
          currentAuthProfile !== authProfile ||
          currentProfile.endpoint !== profile.endpoint ||
          !sameStoredAuthentication(readStoredCredential(currentAuthProfile), credential)
        ) {
          throw new SimApiError(
            `Profile "${redact(profile.name)}" changed while the workspace was being selected. Its newer settings and login were kept.`,
            0
          )
        }
        writeConfigProfile(profileName, {
          auth_profile: authProfile,
          workspace: normalizedWorkspaceId,
        })
      })

      console.log(chalk.green(`✓ Added profile "${safeOneLine(profileName)}" in ${configPath()}`))
      console.log(`  Workspace: ${safeOneLine(workspace.name)} (${workspace.id})`)
      console.log(`  Authentication: ${safeOneLine(authProfile)}`)
      console.log(chalk.dim(`  Try: sim --profile ${safeOneLine(profileName)} whoami`))
    })
}

interface LoginOptions {
  browser: boolean
  method?: 'oauth' | 'api-key'
  readOnly?: boolean
  callbackPort?: string
  yes?: boolean
}

/**
 * Which login to run.
 *
 * An explicit method selects the credential type: OAuth never falls back to
 * an API key, and API-key login skips OAuth discovery. With no method selected,
 * OAuth is preferred, with the pairing-code handoff used for remote terminals
 * or a server without the provider. An unreachable server remains
 * an error rather than being mistaken for one that lacks the feature.
 *
 * `--callback-port` overrides the remote-session guess, because naming the port
 * is how someone with an SSH tunnel says the loopback redirect does reach them.
 */
async function chooseLoginFlow(
  profile: ResolvedProfile,
  options: LoginOptions
): Promise<'oauth' | 'handoff'> {
  requireSecureEndpoint(profile.endpoint)
  if (options.method === 'api-key') return 'handoff'
  if (
    options.method === undefined &&
    isLikelyRemoteSession() &&
    options.callbackPort === undefined
  ) {
    console.log(
      chalk.dim(
        'This looks like a remote session; using the pairing code to create a personal API key. To use OAuth, forward a port and pass --method oauth --callback-port <port>.\n'
      )
    )
    return 'handoff'
  }
  const status = await discoverOAuthProvider(profile.endpoint)
  if (status === 'unreachable') {
    throw new SimApiError(`Could not reach ${profile.endpoint}. Check the endpoint.`, 0)
  }
  if (status === 'unavailable') {
    if (options.method === 'oauth') {
      throw new SimApiError(
        `${profile.endpoint} does not offer OAuth sign-in. Enable OAuth on the server or explicitly choose sim login --method api-key.`,
        0
      )
    }
    console.log(
      chalk.dim(
        `${profile.endpoint} does not offer OAuth sign-in; using the pairing code to create a personal API key.\n`
      )
    )
    return 'handoff'
  }
  return 'oauth'
}

function parseCallbackPort(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new SimApiError(
      `Invalid --callback-port "${redact(value)}". Use a port from 1 to 65535.`,
      0
    )
  }
  return port
}

/**
 * Authorization code + PKCE through the browser; see `oauth-flow.ts`. The
 * profile's workspace default is left as it was: the consent page has no
 * workspace picker, and `sim configure --set-workspace` is one command away.
 */
async function loginWithOAuth(
  profile: ResolvedProfile,
  options: LoginOptions,
  callbackPort: number | undefined,
  expected: LoginProfileSnapshot
): Promise<void> {
  console.log(
    `Signing in to ${chalk.bold(profile.endpoint)} as profile ${chalk.bold(safeOneLine(profile.name))}`
  )

  const tokens = await loginWithBrowser(profile.endpoint, {
    scopes: options.readOnly ? OAUTH_SCOPES_READ_ONLY : OAUTH_SCOPES_FULL,
    callbackPort,
    onAuthorizeUrl: (url) => {
      console.log(`\n${url}`)
      if (options.browser) openBrowser(url)
      console.log(chalk.dim('\nWaiting for you to approve in the browser…'))
    },
  })

  try {
    requireStorableCredential(tokens.accessToken)
    requireStorableCredential(tokens.refreshToken)

    await withCredentialsLock(async () => {
      assertLoginProfileUnchanged(profile.name, expected)
      const credential: StoredCredential = {
        kind: 'oauth',
        oauth: {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: tokens.expiresAt,
          issuer: oauthIssuerForEndpoint(profile.endpoint),
          loginId: randomBytes(16).toString('base64url'),
          scope: tokens.scope,
        },
      }
      writeCredentialsProfile(profile.name, null)
      try {
        writeConfigProfile(profile.name, { endpoint: profile.endpoint })
        writeCredentialsProfile(profile.name, credential)
      } catch (error) {
        try {
          writeConfigProfile(profile.name, { endpoint: expected.endpoint })
          writeCredentialsProfile(profile.name, expected.credential)
        } catch (rollbackError) {
          try {
            writeCredentialsProfile(profile.name, null)
          } catch {}
          console.log(
            chalk.yellow(
              `Could not restore the previous profile safely (${safeOneLine(getErrorMessage(rollbackError))}). Its local login was cleared to avoid using it against the wrong endpoint. The new server login will still be revoked.`
            )
          )
        }
        throw error
      }
    })
  } catch (error) {
    try {
      await revokeToken(profile.endpoint, tokens.refreshToken)
    } catch (revocationError) {
      console.log(
        chalk.yellow(
          `Could not revoke the uncommitted login (${safeOneLine(getErrorMessage(revocationError))}). Revoke Sim CLI in Settings → General → Authorized apps.`
        )
      )
    }
    throw error
  }

  console.log(chalk.green(`\n✓ Logged in. Login stored in ${credentialsPath()}`))
  /**
   * Read back from the granted scope rather than the requested flag. The
   * authorization server decides what it issued, and a person can narrow the
   * grant on the consent page, so `--read-only` is a request and this is the
   * answer.
   */
  console.log(
    chalk.dim(
      grantsWriteAccess(tokens.scope)
        ? '  Renews itself; revoke it any time in Settings → General → Authorized apps, or with: sim logout'
        : '  Read-only login — commands that change anything will be refused.'
    )
  )
  if (!profile.workspaceId) {
    console.log(
      chalk.dim('  No default workspace. Set one with: sim configure --set-workspace <id>')
    )
  }
}

export function loginCommand(): Command {
  return new Command('login')
    .description('Sign in through the browser and store the login for the profile')
    .addOption(
      new Option(
        '--method <method>',
        'Credential to obtain: oauth requires OAuth support; api-key creates a permanent key through pairing (auto-selects when omitted)'
      ).choices(['oauth', 'api-key'])
    )
    .option('--no-browser', 'Print the approval URL without opening it (either login method)')
    .option('--read-only', 'Ask only for permission to read, never to change anything')
    .option('--callback-port <port>', 'Pin the local port the browser returns to')
    .option('-y, --yes', 'Overwrite an existing API-key profile without prompting')
    .action(async (options: LoginOptions, command: Command) => {
      /** Login may name the profile it is about to create. */
      const profile = profileFrom(command, { allowUnknownProfile: true })
      const authProfile = resolveAuthenticationProfileName(profile.name)

      if (authProfile !== profile.name) {
        throw new SimApiError(
          `Profile "${redact(profile.name)}" shares authentication with "${redact(authProfile)}". Run: sim login --profile ${redact(authProfile)}`,
          0
        )
      }

      const snapshot = readLoginProfileSnapshot(profile.name)
      const storedCredential = snapshot.credential
      if (storedCredential?.kind === 'oauth') {
        throw new SimApiError(
          `Profile "${redact(profile.name)}" already has an OAuth login. Run sim logout --profile ${redact(profile.name)} before signing in again.`,
          0
        )
      }
      if (storedCredential && !options.yes) {
        const confirmed = await confirmProfileOverwrite(profile.name)
        if (!confirmed) {
          console.log(chalk.dim('Login cancelled; the existing profile was not changed.'))
          return
        }
      }

      /** Validate a pinned port before opening a browser or starting either flow. */
      const callbackPort = parseCallbackPort(options.callbackPort)

      const loginFlow = await chooseLoginFlow(profile, options)
      /**
       * Neither flag has a meaning in the handoff: it mints a permanent,
       * full-power API key on the server and never opens a local listener.
       * Honouring `--read-only` by ignoring it would hand back the opposite of
       * what was asked for, so the whole login stops here rather than storing a
       * credential the person did not agree to.
       */
      if (loginFlow === 'handoff') {
        if (options.readOnly) {
          throw new SimApiError(
            'API-key login cannot issue a read-only login. Use --method oauth, or drop --read-only.',
            0
          )
        }
        if (callbackPort !== undefined) {
          throw new SimApiError(
            'API-key login has no local callback, so --callback-port does not apply. Use --method oauth, or drop --callback-port.',
            0
          )
        }
      }
      await withProfileLoginLease(profile.name, async () => {
        assertLoginProfileUnchanged(profile.name, snapshot)
        if (loginFlow === 'oauth') {
          await loginWithOAuth(profile, options, callbackPort, snapshot)
          return
        }
        await loginWithHandoff(profile, options, snapshot)
      })
    })
}

/** The pairing-code handoff, which mints a permanent API key; see `device-flow.ts`. */
async function loginWithHandoff(
  profile: ResolvedProfile,
  options: LoginOptions,
  expected: LoginProfileSnapshot
): Promise<void> {
  const auth = createAuthRequest()
  const url = buildApprovalUrl(profile.endpoint, auth, profile.workspaceId ?? undefined)

  console.log(
    `Signing in to ${chalk.bold(profile.endpoint)} as profile ${chalk.bold(safeOneLine(profile.name))}`
  )
  console.log(`\nPairing code: ${chalk.bold(auth.pairing)}`)
  console.log(chalk.dim('Confirm this code matches what the browser shows before approving.\n'))
  console.log(url)

  if (options.browser) openBrowser(url)
  console.log(chalk.dim('\nWaiting for approval…'))

  const key = await pollForKey(profile.endpoint, auth)
  try {
    if (key.scope !== 'platform') {
      throw new SimApiError(
        `Server issued a ${key.scope} key, but the CLI requires a platform API key. Update the Sim deployment and try again.`,
        0
      )
    }

    const settings: Record<string, string | null> = {
      endpoint: profile.endpoint,
      workspace:
        key.workspaceId == null
          ? null
          : normalizeWorkspaceId(key.workspaceId, 'the login response'),
    }
    requireStorableCredential(key.apiKey)

    await withCredentialsLock(async () => {
      assertLoginProfileUnchanged(profile.name, expected)
      writeCredentialsProfile(profile.name, null)
      try {
        writeConfigProfile(profile.name, settings)
        writeCredentialsProfile(profile.name, { kind: 'api_key', apiKey: key.apiKey })
      } catch (error) {
        try {
          writeConfigProfile(profile.name, {
            endpoint: expected.endpoint,
            workspace: expected.workspace,
          })
          writeCredentialsProfile(profile.name, expected.credential)
        } catch (rollbackError) {
          try {
            writeCredentialsProfile(profile.name, null)
          } catch {}
          console.log(
            chalk.yellow(
              `Could not restore the previous profile safely (${safeOneLine(getErrorMessage(rollbackError))}). Its local login was cleared to avoid using it against the wrong endpoint.`
            )
          )
        }
        throw error
      }
    })
  } catch (error) {
    const keyId = typeof key.id === 'string' && key.id ? safeOneLine(key.id) : 'unknown'
    console.log(
      chalk.yellow(
        `API key ${keyId} was created but could not be stored safely. Revoke it in Settings → API keys.`
      )
    )
    throw error
  }

  console.log(chalk.green(`\n✓ Logged in. Key stored in ${credentialsPath()}`))
  if (key.workspaceBound && key.workspaceId) {
    console.log(chalk.dim(`  Workspace-scoped key — it can only reach ${key.workspaceId}.`))
  } else if (key.workspaceId) {
    console.log(
      chalk.dim(
        `  Personal key, defaulting to ${key.workspaceId}. Override per command with --workspace.`
      )
    )
  } else {
    console.log(
      chalk.dim(
        '  Personal key with no default workspace. Set one with: sim configure --set-workspace <id>'
      )
    )
  }
}

/**
 * Revokes the complete server-side token family before forgetting it locally.
 * Settings → General → Authorized apps is broader: it revokes every independent login
 * for the client. An unreachable server must not stop someone clearing their
 * machine, but it is said out loud so nobody assumes revocation succeeded.
 */
async function revokeStoredOAuth(credential: StoredOAuthCredential): Promise<void> {
  let displayEndpoint = safeOneLine(redact(credential.issuer))
  try {
    const issuer = new URL(credential.issuer)
    const displayIssuer = new URL(issuer)
    displayIssuer.username = ''
    displayIssuer.password = ''
    displayEndpoint = safeOneLine(displayIssuer.toString())
    if (
      FORBIDDEN_IN_VALUE.test(credential.issuer) ||
      (issuer.protocol !== 'http:' && issuer.protocol !== 'https:') ||
      issuer.username ||
      issuer.password ||
      issuer.search ||
      issuer.hash ||
      !issuer.pathname.endsWith('/api/auth')
    ) {
      throw new Error('stored issuer is invalid')
    }
    issuer.pathname = issuer.pathname.slice(0, -'/api/auth'.length) || '/'
    const endpoint = issuer.toString().replace(/\/$/, '')
    displayEndpoint = safeOneLine(endpoint)
    await revokeToken(endpoint, credential.refreshToken)
    console.log(chalk.dim('  Signed out of Sim; every token from this login was revoked.'))
  } catch (error) {
    console.log(
      chalk.yellow(
        `  Could not revoke the login on ${displayEndpoint} (${safeOneLine(getErrorMessage(error))}). Revoke it in Settings → General → Authorized apps.`
      )
    )
  }
}

export function logoutCommand(): Command {
  return new Command('logout')
    .description("Sign out and remove the profile's stored login")
    .option('--all', 'Remove the profile entirely, including its settings')
    .action(async (options: { all?: boolean }, command: Command) => {
      if (options.all) {
        const profileName = selectedProfileName(command)
        const { removed, credential } = await withCredentialsLock(async () => {
          const dependents = listAuthenticationDependents(profileName)
          if (dependents.length > 0) {
            throw new SimApiError(
              `Cannot remove authentication profile "${redact(profileName)}" because it is used by: ${dependents.map(redact).join(', ')}. Remove those profiles first.`,
              0
            )
          }
          const credential = readStoredCredential(profileName)
          if (credential?.kind === 'oauth') {
            await revokeStoredOAuth(credential.oauth)
          }
          return { removed: deleteProfile(profileName), credential }
        })
        if (!removed.config && !removed.credentials) {
          console.log(chalk.dim(`Nothing stored for profile "${safeOneLine(profileName)}".`))
          return
        }
        console.log(chalk.green(`✓ Removed profile "${safeOneLine(profileName)}".`))
        if (credential?.kind === 'api_key') {
          console.log(
            chalk.dim('  The key itself is still active — revoke it in Settings → API keys.')
          )
        }
        return
      }

      const profileName = selectedProfileName(command)
      const authProfile = resolveAuthenticationProfileName(profileName)
      if (authProfile !== profileName) {
        throw new SimApiError(
          `Profile "${redact(profileName)}" shares authentication with "${redact(authProfile)}". Log out of the authentication profile instead: sim logout --profile ${redact(authProfile)}`,
          0
        )
      }

      const credential = await withCredentialsLock(async () => {
        const credential = readStoredCredential(profileName)
        if (!credential) return null
        if (credential.kind === 'oauth') {
          await revokeStoredOAuth(credential.oauth)
        }
        writeCredentialsProfile(profileName, null)
        return credential
      })
      if (!credential) {
        console.log(chalk.dim(`No stored login for profile "${safeOneLine(profileName)}".`))
        return
      }

      console.log(
        chalk.green(`✓ Removed the stored login for profile "${safeOneLine(profileName)}".`)
      )
      if (credential.kind === 'api_key') {
        /** Local API-key removal cannot revoke the server-side key. */
        console.log(
          chalk.dim('  The key itself is still active — revoke it in Settings → API keys.')
        )
      }
    })
}

interface VerifiedWorkspace {
  id: string
  name: string
  memberCount: number
}

/**
 * The outcome of checking the resolved settings against the API.
 *
 * Split by cause rather than into a boolean because each cause has a different
 * fix, and `whoami` exists to name that fix: a rejected key needs a new login, a
 * missing workspace needs `sim configure`, and an unreachable endpoint needs
 * neither.
 */
type Verification = { keyType: KeyType | null } & (
  | { status: 'verified'; workspace: VerifiedWorkspace; detail: null }
  | {
      status: 'rejected' | 'unreachable' | 'unauthenticated' | 'no-workspace' | 'disabled'
      workspace: null
      detail: string
    }
)

type KeyType = GetMetaResponse['data']['keyType']

/**
 * Reads which kind of key is in play, as a diagnostic only.
 *
 * `PRINCIPAL_KIND_NOT_PERMITTED` is the failure this answers: a personal key on
 * a workspace-key operation refuses every call, and the natural move — running
 * `whoami` — used to show a green check and say nothing about the kind. Failures
 * are swallowed to `null` because the verdict and the exit code belong to the
 * workspace read below; a diagnostic must not change either.
 */
async function readKeyType(client: Pick<SimClient, 'request'>): Promise<KeyType | null> {
  const operation = V2_OPERATIONS.getMeta
  try {
    const response = await client.request<GetMetaResponse>(operation.path, {
      method: operation.method,
    })
    return response.data.keyType
  } catch {
    return null
  }
}

/**
 * The only answers that are a verdict on the credentials themselves.
 *
 * 401 and 403 are the server judging the key; 404 means the configured
 * workspace is not one this key can see. Everything else — a 502 from a proxy
 * mid-deploy, a 429, a transport failure (status 0), an endpoint answering 200
 * with a login page — says nothing about the key, and calling it `rejected`
 * told a user to run `sim login` for something logging in cannot fix. That is
 * the flaky-VPN confusion the exit-code split exists to prevent.
 */
const CREDENTIAL_VERDICT_STATUSES = new Set([401, 403, 404])

/**
 * `whoami` is the command people run to answer "am I set up correctly?", so the
 * exit status has to carry that answer — reporting a junk key with exit 0 is the
 * defect this mapping closes.
 *
 * 1 is the CLI's blanket "explained failure" code and means the credentials
 * themselves are wrong. 2 is reserved for a check that could not be made at all:
 * that is a different fix — retrying or setting a workspace helps, logging in
 * again does not — and a script must be able to tell the two apart.
 */
const WHOAMI_EXIT_CODES = {
  verified: 0,
  disabled: 0,
  unauthenticated: 1,
  rejected: 1,
  unreachable: 2,
  'no-workspace': 2,
} as const satisfies Record<Verification['status'], number>

/**
 * Confirms the resolved key really works, by reading the profile's own
 * workspace.
 *
 * `getWorkspace` is the check because it is the cheapest read that proves all
 * three settings at once — the endpoint answers, the key is accepted, and the
 * key can reach the configured workspace — and because it comes back with the
 * workspace's *name*, which is what tells a user the id they pasted is the
 * workspace they meant.
 *
 * It is workspace-scoped, so a profile with no workspace has nothing to check
 * against. That is reported rather than papered over with an account-scoped call
 * a workspace-bound key would fail for reasons having nothing to do with its
 * validity.
 */
async function verifyProfile(
  client: Pick<SimClient, 'request'>,
  profile: ResolvedProfile
): Promise<Verification> {
  if (!profile.apiKey && !profile.oauth) {
    return {
      status: 'unauthenticated',
      workspace: null,
      keyType: null,
      detail: `not logged in — run: sim login --profile ${safeOneLine(profile.name)}`,
    }
  }

  // Read the kind before the workspace, so it is reported even for a profile
  // with no workspace to check against — the case where a key that cannot be
  // used is most likely to look merely unconfigured.
  const keyType = await readKeyType(client)

  if (!profile.workspaceId) {
    return {
      status: 'no-workspace',
      workspace: null,
      keyType,
      detail: `no workspace to check against — run: sim configure --profile ${safeOneLine(profile.name)} --set-workspace <id>`,
    }
  }

  const operation = V2_OPERATIONS.getWorkspace
  try {
    const response = await client.request<GetWorkspaceResponse>(
      resolvePath(operation.path, { workspaceId: profile.workspaceId }),
      { method: operation.method }
    )
    const { id, name, memberCount } = response.data
    // Projected field by field: the record carries display fields the machine
    // output has no business inventing a contract for.
    return { status: 'verified', workspace: { id, name, memberCount }, keyType, detail: null }
  } catch (error) {
    if (!(error instanceof SimApiError)) throw error
    return {
      status: CREDENTIAL_VERDICT_STATUSES.has(error.status) ? 'rejected' : 'unreachable',
      workspace: null,
      keyType,
      detail: error.message,
    }
  }
}

function presentVerification(verification: Verification): string {
  if (verification.status === 'verified') {
    const { name, memberCount } = verification.workspace
    const members = `${memberCount} ${memberCount === 1 ? 'member' : 'members'}`
    // The name is server-supplied and lands in a terminal unescaped otherwise.
    return `${chalk.green('✓')} ${safeOneLine(name)} · ${members}`
  }

  const detail = safeOneLine(verification.detail)
  switch (verification.status) {
    case 'rejected':
      return `${chalk.red('✗')} ${detail}`
    case 'unauthenticated':
      return chalk.yellow(`not logged in — ${detail}`)
    case 'disabled':
      return chalk.dim(detail)
    default:
      return chalk.yellow(`could not check — ${detail}`)
  }
}

export function whoamiCommand(): Command {
  return new Command('whoami')
    .description('Show the resolved profile, where each setting came from, and whether it works')
    .option('--no-verify', 'Skip the API check and only print the resolved settings')
    .action(async (options: { verify: boolean }, command: Command) => {
      const { client, profile } = clientFrom(command)
      const { sources } = profile
      const authentication = presentAuthentication(sources.credential)

      const verification: Verification = options.verify
        ? await verifyProfile(client, profile)
        : {
            status: 'disabled',
            workspace: null,
            keyType: null,
            detail: 'not checked (--no-verify)',
          }

      const annotate = (value: string, source: string) =>
        source === 'unset' ? chalk.dim('not set') : `${value} ${chalk.dim(`(${source})`)}`

      printRecord(
        profile.output,
        [
          ['Profile', profile.name],
          ['Endpoint', annotate(profile.endpoint, sources.endpoint)],
          [
            'Login',
            authentication.authenticated
              ? annotate(profile.oauth ? 'OAuth' : 'API key', authentication.source)
              : chalk.yellow('not logged in'),
          ],
          [
            'Key type',
            verification.keyType ??
              chalk.dim(options.verify ? 'unknown' : 'not checked (--no-verify)'),
          ],
          ['Workspace', annotate(profile.workspaceId ?? '', sources.workspaceId)],
          ['Output', annotate(profile.output, sources.output)],
          ['Verified', presentVerification(verification)],
        ],
        {
          profile: profile.name,
          endpoint: profile.endpoint,
          workspaceId: profile.workspaceId,
          output: profile.output,
          authenticated: authentication.authenticated,
          sources: {
            endpoint: sources.endpoint,
            authentication: authentication.source,
            workspaceId: sources.workspaceId,
            output: sources.output,
          },
          verification: {
            status: verification.status,
            workspace: verification.workspace,
            keyType: verification.keyType,
            detail: verification.detail,
          },
        }
      )

      // Set rather than thrown: the resolved settings above are the answer the
      // user came for, and a thrown error would replace them with one red line.
      const exitCode = WHOAMI_EXIT_CODES[verification.status]
      if (exitCode !== 0) process.exitCode = exitCode
    })
}

interface ProfileRow {
  name: string
  active: boolean
  hasKey: boolean
  /** The profile whose stored login this one uses; itself unless it is an alias. */
  authProfile: string | null
  /** Why the row could not be resolved, for a profile with a broken `auth_profile`. */
  error: string | null
}

const PROFILE_COLUMNS: Column<ProfileRow>[] = [
  { header: '', value: (row) => (row.active ? chalk.green('*') : ' ') },
  { header: 'profile', value: (row) => safeOneLine(row.name) },
  { header: 'key', value: (row) => (row.error ? text(null) : row.hasKey ? 'yes' : 'no') },
  { header: 'auth', value: (row) => (row.authProfile ? safeOneLine(row.authProfile) : text(null)) },
  { header: 'error', value: (row) => (row.error ? chalk.red(safeOneLine(row.error)) : text(null)) },
]

/**
 * `profiles` is the command someone runs *because* a profile is broken, so a bad
 * `auth_profile` marks its own row rather than aborting the listing and leaving
 * them with nothing shown at all.
 */
function buildProfileRow(name: string, active: boolean): ProfileRow {
  try {
    const authProfile = resolveAuthenticationProfileName(name)
    return {
      name,
      active,
      hasKey: readStoredCredential(authProfile) !== null,
      authProfile,
      error: null,
    }
  } catch (error) {
    if (!(error instanceof ProfileConfigError)) throw error
    return { name, active, hasKey: false, authProfile: null, error: error.message }
  }
}

/**
 * The active profile's name and the format to render in, tolerating a profile
 * that does not resolve.
 *
 * Resolving the active profile is what supplies both, but it can also throw —
 * and `profiles` is the command someone runs *because* a profile is broken, so
 * a broken active profile has to appear as a marked row like any other rather
 * than abort the listing. An unknown *name* is still refused: `profiles
 * --profile typo` must fail like every other command instead of listing under a
 * name that means nothing.
 */
function profileListingContext(command: Command): { activeName: string; output: OutputFormat } {
  try {
    const profile = profileFrom(command)
    return { activeName: profile.name, output: profile.output }
  } catch (error) {
    if (!(error instanceof ProfileConfigError)) throw error
    // A blank `--profile`/`--endpoint`/`--workspace` is the caller's own
    // argument, not a broken profile. The tolerance below exists so a listing
    // still happens when the config is unreadable; letting it also absorb a
    // refused flag turned `sim --workspace "" profiles` into a successful
    // listing while every other command exits 1 on the same argv.
    if (error instanceof ProfileOverrideError) throw error

    const globals = globalsOf(command)
    const named = globals.profile || process.env.SIM_PROFILE
    if (named && named !== DEFAULT_PROFILE && !listProfiles().includes(named)) throw error

    // A bad format is the caller's own request, not a broken profile: falling
    // back to a table would hand a script human output with exit 0. Only the
    // profile's *resolution* is tolerated here, never its arguments.
    const requested = globals.output ?? process.env.SIM_OUTPUT
    if (requested && !(OUTPUT_FORMATS as readonly string[]).includes(requested)) throw error

    return {
      activeName: named || DEFAULT_PROFILE,
      output: requested ? (requested as OutputFormat) : 'table',
    }
  }
}

export function profilesCommand(): Command {
  const command = new Command('profiles')
    .alias('profile')
    .description('List profiles or add a workspace profile that shares a stored login')

  const printProfiles = (_options: unknown, actionCommand: Command): void => {
    // Resolving is what makes `profiles --profile typo` fail like every other
    // command instead of listing happily under a name that resolves to nothing,
    // and it is also what supplies the output format the listing renders in.
    const { activeName, output } = profileListingContext(actionCommand)
    const rows = listProfiles().map((name) => buildProfileRow(name, name === activeName))

    if (rows.length === 0) {
      // The prose belongs to the human formats; a script asking for json must
      // get an empty list, not a sentence it cannot parse.
      if (output === 'table') console.log(chalk.dim('No profiles yet. Run: sim login'))
      else printList(output, rows, PROFILE_COLUMNS)
      return
    }

    printList(output, rows, PROFILE_COLUMNS)
  }

  // `list` is registered as the default rather than the group carrying an action
  // of its own. An action handler on a group is what took `profiles` out of the
  // pure-dispatcher set that `refuseHelpAfterUnknownCommand` guards, so
  // `sim profiles zzznope --help` printed the group's help and exited `0` while
  // the same words under any of the other 54 groups exit `1` — the exit code a
  // capability probe reads to ask whether a command exists. Only `files restore`
  // genuinely needs that exemption, and it keeps it by taking a real operand.
  command.addCommand(
    new Command('list')
      // A stray operand here is a mistyped subcommand the group already refused
      // below; refusing it again keeps `sim profiles list zzznope` honest.
      .allowExcessArguments(false)
      .description('List configured profiles')
      .action(printProfiles),
    { isDefault: true }
  )
  command.addCommand(addProfileCommand())

  // Commander hands the default subcommand any operand that names no other one,
  // so without this `sim profiles zzznope` listed profiles and exited `0`. The
  // check runs before the dispatch and defers to commander's own reporting, so
  // the message, the "did you mean" suggestion, and the exit code are the ones
  // every other group produces.
  const known = new Set(command.commands.flatMap((child) => [child.name(), ...child.aliases()]))
  command.hook('preSubcommand', (group) => {
    const first = group.args[0]
    if (first !== undefined && !first.startsWith('-') && !known.has(first)) {
      ;(group as Command & { unknownCommand: () => never }).unknownCommand()
    }
  })

  return command
}

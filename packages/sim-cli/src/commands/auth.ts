import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline/promises'
import chalk from 'chalk'
import { Command } from 'commander'
import {
  buildApprovalUrl,
  type CliAuthScope,
  createAuthRequest,
  pollForKey,
} from '../auth/device-flow'
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
  ProfileConfigError,
  type ResolvedProfile,
  readCredentialsProfile,
  resolveAuthenticationProfileName,
  type SettingSource,
  validateProfileName,
  writeConfigProfile,
  writeCredentialsProfile,
} from '../config/index'
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
      throw new SimApiError(`Unexpected API key source "${source}".`, 0)
  }
}

async function confirmProfileOverwrite(profileName: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    throw new SimApiError(
      `Profile "${profileName}" already exists. Re-run with --yes to overwrite it.`,
      0
    )
  }

  const prompt = createInterface({ input: process.stdin, output: process.stderr })
  try {
    const answer = await prompt.question(
      `Profile "${profileName}" already exists. Replace its API key and login defaults? (y/N) `
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
      `Profile "${profileName}" already exists. Remove it first with: sim logout --all --profile ${profileName}`,
      0
    )
  }
}

/**
 * Refuses a minted key the credentials file could not represent.
 *
 * The poll response is remote input, and the deployment answering it is
 * whatever the endpoint names. A key carrying a line break would be written
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
function requireStorableKey(apiKey: unknown): void {
  if (
    typeof apiKey !== 'string' ||
    !apiKey ||
    apiKey !== apiKey.trim() ||
    FORBIDDEN_IN_VALUE.test(apiKey)
  ) {
    throw new SimApiError(
      'The server returned a malformed API key. Nothing was stored; check the endpoint.',
      0
    )
  }
}

function requireStoredAuthentication(profile: ResolvedProfile): string {
  const authProfile = resolveAuthenticationProfileName(profile.name)
  const storedKey = readCredentialsProfile(authProfile).api_key
  if (profile.sources.apiKey !== 'credentials' || !storedKey) {
    throw new SimApiError(
      `Cannot create a shared profile from "${profile.name}": the active API key is not stored. Run: sim login --profile ${authProfile}`,
      0
    )
  }
  if (profile.sources.endpoint === 'flag' || profile.sources.endpoint === 'env') {
    throw new SimApiError(
      `Cannot create a shared profile from "${profile.name}": the active endpoint comes from ${profile.sources.endpoint}. Save it with: sim configure --profile ${authProfile} --set-endpoint ${profile.endpoint}`,
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
    throw new SimApiError('The active API key cannot access any workspaces.', 0)
  }
  if (workspaces.length > MAX_INTERACTIVE_WORKSPACES) {
    throw new SimApiError(
      `The active API key can access more than ${MAX_INTERACTIVE_WORKSPACES} workspaces, which is too many to show interactively. Pass --workspace <id> instead.`,
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
      const workspaceId = globalsOf(command).workspace
      const workspace = workspaceId
        ? await getWorkspaceById(client, workspaceId)
        : await chooseWorkspace(client)

      writeConfigProfile(profileName, {
        auth_profile: authProfile,
        // Server-supplied, exactly like the login response's workspace id, so it
        // is checked the same way: the writer would refuse an unstorable one
        // anyway, but with a message about the file format rather than the
        // response that produced it.
        workspace: normalizeWorkspaceId(workspace.id, 'the workspace response'),
      })

      console.log(chalk.green(`✓ Added profile "${profileName}" in ${configPath()}`))
      console.log(`  Workspace: ${safeOneLine(workspace.name)} (${workspace.id})`)
      console.log(`  Authentication: ${authProfile}`)
      console.log(chalk.dim(`  Try: sim --profile ${profileName} whoami`))
    })
}

export function loginCommand(): Command {
  return new Command('login')
    .description('Authorize this terminal and store an API key for the profile')
    .option('--scope <scope>', 'Key space to mint from: platform or copilot', 'platform')
    .option('--no-browser', 'Print the URL instead of opening a browser')
    .option('-y, --yes', 'Overwrite an existing profile without prompting')
    .action(
      async (options: { scope: string; browser: boolean; yes?: boolean }, command: Command) => {
        // `login --profile x` is how a profile comes into existence, so the name
        // is allowed to be one resolution would otherwise reject as unknown.
        const profile = profileFrom(command, { allowUnknownProfile: true })
        const authProfile = resolveAuthenticationProfileName(profile.name)

        if (authProfile !== profile.name) {
          throw new SimApiError(
            `Profile "${profile.name}" shares authentication with "${authProfile}". Run: sim login --profile ${authProfile}`,
            0
          )
        }

        if (options.scope !== 'platform' && options.scope !== 'copilot') {
          throw new SimApiError(`Unknown scope "${options.scope}". Use platform or copilot.`, 0)
        }
        const scope = options.scope as CliAuthScope

        if (readCredentialsProfile(profile.name).api_key && !options.yes) {
          const confirmed = await confirmProfileOverwrite(profile.name)
          if (!confirmed) {
            console.log(chalk.dim('Login cancelled; the existing profile was not changed.'))
            return
          }
        }

        const auth = createAuthRequest()
        const url = buildApprovalUrl(
          profile.endpoint,
          auth,
          scope,
          profile.workspaceId ?? undefined
        )

        console.log(
          `Signing in to ${chalk.bold(profile.endpoint)} as profile ${chalk.bold(profile.name)}`
        )
        console.log(`\nPairing code: ${chalk.bold(auth.pairing)}`)
        console.log(
          chalk.dim('Confirm this code matches what the browser shows before approving.\n')
        )
        console.log(url)

        if (options.browser) openBrowser(url)
        console.log(chalk.dim('\nWaiting for approval…'))

        const key = await pollForKey(profile.endpoint, auth)

        if (key.scope !== scope) {
          // The approval, not the request, decides the scope. Storing a copilot
          // key where a platform key belongs would fail every later call with an
          // unexplained 401, so refuse now with the reason.
          throw new SimApiError(
            `Server issued a ${key.scope} key but this profile needs a ${scope} key. Update the Sim deployment, or run: sim login --scope ${key.scope}`,
            0
          )
        }

        // The workspace picked in the browser becomes the profile's default,
        // whether or not the key is scoped to it. The user chose it by name —
        // making them look up its id afterwards would waste the one moment the
        // answer was already on screen. It arrives off the wire, so it is
        // checked before either file is touched.
        //
        // Absence is the whole of "no workspace" here, and it is a legitimate
        // outcome — a personal key with nothing selected in the browser. A
        // *present* value is a workspace id, so every one of them goes to
        // `normalizeWorkspaceId` to be accepted or refused by name. Testing
        // truthiness instead let an empty string through the absent branch, so
        // a malformed response was quietly stored as "no workspace" rather than
        // reported.
        const settings: Record<string, string | null> = {
          endpoint: profile.endpoint,
          workspace:
            key.workspaceId == null
              ? null
              : normalizeWorkspaceId(key.workspaceId, 'the login response'),
        }
        requireStorableKey(key.apiKey)

        // Config before credentials: the endpoint decides where the key is sent
        // later. Storing the key first and then failing on the settings left a
        // key on disk with no endpoint beside it, so the next command fell back
        // to the default host — sending a self-hosted key somewhere else.
        writeConfigProfile(profile.name, settings)
        writeCredentialsProfile(profile.name, key.apiKey)

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
    )
}

export function logoutCommand(): Command {
  return new Command('logout')
    .description("Remove the profile's stored API key")
    .option('--all', 'Remove the profile entirely, including its settings')
    .action((options: { all?: boolean }, command: Command) => {
      if (options.all) {
        const profileName = selectedProfileName(command)
        const dependents = listAuthenticationDependents(profileName)
        if (dependents.length > 0) {
          throw new SimApiError(
            `Cannot remove authentication profile "${profileName}" because it is used by: ${dependents.join(', ')}. Remove those profiles first.`,
            0
          )
        }
        const removed = deleteProfile(profileName)
        if (!removed.config && !removed.credentials) {
          console.log(chalk.dim(`Nothing stored for profile "${profileName}".`))
          return
        }
        console.log(chalk.green(`✓ Removed profile "${profileName}".`))
        return
      }

      const profile = profileFrom(command)
      const authProfile = resolveAuthenticationProfileName(profile.name)
      if (authProfile !== profile.name) {
        throw new SimApiError(
          `Profile "${profile.name}" shares authentication with "${authProfile}". Log out of the authentication profile instead: sim logout --profile ${authProfile}`,
          0
        )
      }

      if (!readCredentialsProfile(profile.name).api_key) {
        console.log(chalk.dim(`No stored key for profile "${profile.name}".`))
        return
      }

      writeCredentialsProfile(profile.name, null)
      console.log(chalk.green(`✓ Removed the stored key for profile "${profile.name}".`))
      // The key still exists server-side; leaving that unsaid invites the
      // assumption that logging out revoked it.
      console.log(chalk.dim('  The key itself is still active — revoke it in Settings → API keys.'))
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
  if (!profile.apiKey) {
    return {
      status: 'unauthenticated',
      workspace: null,
      keyType: null,
      detail: `no API key — run: sim login --profile ${profile.name}`,
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
      detail: `no workspace to check against — run: sim configure --profile ${profile.name} --set-workspace <id>`,
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
      const authentication = presentAuthentication(sources.apiKey)

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
            'API key',
            authentication.authenticated
              ? annotate('configured', authentication.source)
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
  { header: 'profile', value: (row) => text(row.name) },
  { header: 'key', value: (row) => (row.error ? text(null) : row.hasKey ? 'yes' : 'no') },
  { header: 'auth', value: (row) => text(row.authProfile) },
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
      hasKey: Boolean(readCredentialsProfile(authProfile).api_key),
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

  command.action(printProfiles)
  command.addCommand(
    new Command('list').description('List configured profiles').action(printProfiles)
  )
  command.addCommand(addProfileCommand())
  return command
}

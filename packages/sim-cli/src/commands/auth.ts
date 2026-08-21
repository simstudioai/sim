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
  listAuthenticationDependents,
  listProfiles,
  type ResolvedProfile,
  readCredentialsProfile,
  resolveAuthenticationProfileName,
  type SettingSource,
  writeConfigProfile,
  writeCredentialsProfile,
} from '../config/index'
import { clientFrom, globalsOf, profileFrom } from '../context'
import {
  type GetWorkspaceResponse,
  type ListWorkspacesResponse,
  V2_OPERATIONS,
} from '../generated/v2-api'
import { requestAllPages, resolvePath, SimApiError, type SimClient } from '../http/client'
import { printRecord, safeOneLine } from '../output/render'

type SelectableWorkspace = ListWorkspacesResponse['data'][number]

const PROFILE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
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
  if (!PROFILE_NAME_PATTERN.test(profileName)) {
    throw new SimApiError(
      `Invalid profile name "${profileName}". Use letters, numbers, dots, underscores, or hyphens, starting with a letter or number.`,
      0
    )
  }
  if (listProfiles().includes(profileName)) {
    throw new SimApiError(
      `Profile "${profileName}" already exists. Remove it first with: sim logout --all --profile ${profileName}`,
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
        workspace: workspace.id,
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
        const profile = profileFrom(command)
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

        writeCredentialsProfile(profile.name, key.apiKey)

        // The workspace picked in the browser becomes the profile's default,
        // whether or not the key is scoped to it. The user chose it by name —
        // making them look up its id afterwards would waste the one moment the
        // answer was already on screen.
        const settings: Record<string, string | null> = {
          endpoint: profile.endpoint,
          workspace: key.workspaceId ?? null,
        }
        writeConfigProfile(profile.name, settings)

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
type Verification =
  | { status: 'verified'; workspace: VerifiedWorkspace; detail: null }
  | {
      status: 'rejected' | 'unreachable' | 'unauthenticated' | 'no-workspace' | 'disabled'
      workspace: null
      detail: string
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
      detail: `no API key — run: sim login --profile ${profile.name}`,
    }
  }
  if (!profile.workspaceId) {
    return {
      status: 'no-workspace',
      workspace: null,
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
    return { status: 'verified', workspace: { id, name, memberCount }, detail: null }
  } catch (error) {
    if (!(error instanceof SimApiError)) throw error
    return {
      status: CREDENTIAL_VERDICT_STATUSES.has(error.status) ? 'rejected' : 'unreachable',
      workspace: null,
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
        : { status: 'disabled', workspace: null, detail: 'not checked (--no-verify)' }

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

export function profilesCommand(): Command {
  const command = new Command('profiles')
    .alias('profile')
    .description('List profiles or add a workspace profile that shares a stored login')

  const printProfiles = (_options: unknown, actionCommand: Command): void => {
    const profiles = listProfiles()
    if (profiles.length === 0) {
      console.log(chalk.dim('No profiles yet. Run: sim login'))
      return
    }

    const active = selectedProfileName(actionCommand)
    for (const name of profiles) {
      const marker = name === active ? chalk.green('*') : ' '
      const authProfile = resolveAuthenticationProfileName(name)
      const hasKey = Boolean(readCredentialsProfile(authProfile).api_key)
      const authentication = authProfile === name ? '' : chalk.dim(`  (auth: ${authProfile})`)
      console.log(`${marker} ${name}${hasKey ? '' : chalk.dim('  (no key)')}${authentication}`)
    }
  }

  command.action(printProfiles)
  command.addCommand(
    new Command('list').description('List configured profiles').action(printProfiles)
  )
  command.addCommand(addProfileCommand())
  return command
}

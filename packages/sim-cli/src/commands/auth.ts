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
  credentialsPath,
  deleteProfile,
  listProfiles,
  readCredentialsProfile,
  type SettingSource,
  writeConfigProfile,
  writeCredentialsProfile,
} from '../config/index'
import { profileFrom } from '../context'
import { SimApiError } from '../http/client'
import { printRecord } from '../output/render'

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

export function loginCommand(): Command {
  return new Command('login')
    .description('Authorize this terminal and store an API key for the profile')
    .option('--scope <scope>', 'Key space to mint from: platform or copilot', 'platform')
    .option('--no-browser', 'Print the URL instead of opening a browser')
    .option('-y, --yes', 'Overwrite an existing profile without prompting')
    .action(
      async (options: { scope: string; browser: boolean; yes?: boolean }, command: Command) => {
        const profile = profileFrom(command)

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
      const profile = profileFrom(command)

      if (options.all) {
        const removed = deleteProfile(profile.name)
        if (!removed.config && !removed.credentials) {
          console.log(chalk.dim(`Nothing stored for profile "${profile.name}".`))
          return
        }
        console.log(chalk.green(`✓ Removed profile "${profile.name}".`))
        return
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

export function whoamiCommand(): Command {
  return new Command('whoami')
    .description('Show the resolved profile and where each setting came from')
    .action((_options: unknown, command: Command) => {
      const profile = profileFrom(command)
      const { sources } = profile
      const authentication = presentAuthentication(sources.apiKey)

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
        }
      )
    })
}

export function profilesCommand(): Command {
  return new Command('profiles')
    .alias('profile')
    .description('List the profiles defined in the config and credentials files')
    .action((_options: unknown, command: Command) => {
      const profiles = listProfiles()
      if (profiles.length === 0) {
        console.log(chalk.dim('No profiles yet. Run: sim login'))
        return
      }

      const active = profileFrom(command).name
      for (const name of profiles) {
        const marker = name === active ? chalk.green('*') : ' '
        const hasKey = Boolean(readCredentialsProfile(name).api_key)
        console.log(`${marker} ${name}${hasKey ? '' : chalk.dim('  (no key)')}`)
      }
    })
}

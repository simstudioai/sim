import { spawn } from 'node:child_process'
import chalk from 'chalk'
import { Command } from 'commander'
import {
  buildApprovalUrl,
  type CliAuthScope,
  createAuthRequest,
  pollForKey,
} from '../auth/device-flow.js'
import {
  credentialsPath,
  deleteProfile,
  listProfiles,
  readCredentialsProfile,
  writeConfigProfile,
  writeCredentialsProfile,
} from '../config/index.js'
import { profileFrom } from '../context.js'
import { SimApiError } from '../http/client.js'
import { printRecord } from '../output/render.js'

/**
 * Best-effort browser launch. Failure is not an error: the URL is always printed
 * first, so a headless box, an SSH session, or a machine with no handler just
 * falls through to the user pasting it somewhere.
 */
function openBrowser(url: string): void {
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
  try {
    const child = spawn(command, [url], {
      stdio: 'ignore',
      detached: true,
      shell: process.platform === 'win32',
    })
    child.on('error', () => {})
    child.unref()
  } catch {}
}

function maskKey(key: string): string {
  return key.length <= 10 ? '•'.repeat(key.length) : `${key.slice(0, 6)}…${key.slice(-4)}`
}

export function loginCommand(): Command {
  return new Command('login')
    .description('Authorize this terminal and store an API key for the profile')
    .option('--scope <scope>', 'Key space to mint from: platform or copilot', 'platform')
    .option('--no-browser', 'Print the URL instead of opening a browser')
    .action(async (options: { scope: string; browser: boolean }, command: Command) => {
      const profile = profileFrom(command)

      if (options.scope !== 'platform' && options.scope !== 'copilot') {
        throw new SimApiError(`Unknown scope "${options.scope}". Use platform or copilot.`, 0)
      }
      const scope = options.scope as CliAuthScope

      const auth = createAuthRequest()
      const url = buildApprovalUrl(profile.endpoint, auth, scope, profile.workspaceId ?? undefined)

      console.log(
        `Signing in to ${chalk.bold(profile.endpoint)} as profile ${chalk.bold(profile.name)}`
      )
      console.log(`\nPairing code: ${chalk.bold(auth.pairing)}`)
      console.log(chalk.dim('Confirm this code matches what the browser shows before approving.\n'))
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
      const settings: Record<string, string> = { endpoint: profile.endpoint }
      if (key.workspaceId) settings.workspace = key.workspaceId
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
      } else if (!profile.workspaceId) {
        console.log(
          chalk.dim(
            '  Personal key with no default workspace. Set one with: sim configure --set-workspace <id>'
          )
        )
      }
    })
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

      const annotate = (value: string, source: string) =>
        source === 'unset' ? chalk.dim('not set') : `${value} ${chalk.dim(`(${source})`)}`

      printRecord(
        profile.output,
        [
          ['Profile', profile.name],
          ['Endpoint', annotate(profile.endpoint, sources.endpoint)],
          [
            'API key',
            profile.apiKey
              ? annotate(maskKey(profile.apiKey), sources.apiKey)
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
          authenticated: Boolean(profile.apiKey),
          sources,
        }
      )
    })
}

export function profilesCommand(): Command {
  return new Command('profiles')
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

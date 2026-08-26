import chalk from 'chalk'
import { Command } from 'commander'
import {
  configPath,
  OUTPUT_FORMATS,
  readConfigProfile,
  resolveAuthenticationProfileName,
  writeConfigProfile,
} from '../config/index'
import { normalizeEndpoint } from '../config/profile'
import { profileFrom } from '../context'
import { SimApiError } from '../http/client'

/**
 * Rejects a `--set-…` flag given an empty value.
 *
 * An empty string is falsy, so the setter fell through to the "print current
 * settings" branch and exited 0 having silently ignored the flag. Removing a
 * setting is what `--unset` is for, so the message points there.
 */
function requireValue(value: string | undefined, flag: string, key: string): void {
  if (value !== undefined && value.trim() === '') {
    throw new SimApiError(
      `${flag} requires a value. To remove it, run: sim configure --unset ${key}`,
      0
    )
  }
}

/**
 * Non-secret profile settings. Credentials are deliberately not settable here —
 * they arrive through `sim login`, which is the only path that mints a key with
 * a recorded consent behind it.
 */
export function configureCommand(): Command {
  return new Command('configure')
    .description("Set a profile's endpoint, default workspace, or output format")
    .option('--set-endpoint <url>', 'Sim deployment to talk to')
    .option('--set-workspace <id>', 'Default workspace for workspace-scoped commands')
    .option('--set-output <format>', `Default output format (${OUTPUT_FORMATS.join(' | ')})`)
    .option('--unset <key...>', 'Remove settings (endpoint, workspace, output)')
    .action(
      (
        options: {
          setEndpoint?: string
          setWorkspace?: string
          setOutput?: string
          unset?: string[]
        },
        command: Command
      ) => {
        // `configure --profile x --set-…` is a documented way to create a
        // profile, so the name is allowed to be one that does not exist yet.
        const profile = profileFrom(command, { allowUnknownProfile: true })
        const authProfile = resolveAuthenticationProfileName(profile.name)
        const updates: Record<string, string | null> = {}

        requireValue(options.setEndpoint, '--set-endpoint', 'endpoint')
        requireValue(options.setWorkspace, '--set-workspace', 'workspace')
        requireValue(options.setOutput, '--set-output', 'output')

        if (options.setEndpoint) {
          if (authProfile !== profile.name) {
            throw new SimApiError(
              `Profile "${profile.name}" shares its endpoint with authentication profile "${authProfile}". Run: sim configure --profile ${authProfile} --set-endpoint ${options.setEndpoint}`,
              0
            )
          }
          updates.endpoint = normalizeEndpoint(options.setEndpoint, '--set-endpoint')
        }
        if (options.setWorkspace) updates.workspace = options.setWorkspace
        if (options.setOutput) {
          if (!(OUTPUT_FORMATS as readonly string[]).includes(options.setOutput)) {
            throw new SimApiError(
              `Unknown output format "${options.setOutput}". Use one of: ${OUTPUT_FORMATS.join(', ')}`,
              0
            )
          }
          updates.output = options.setOutput
        }

        for (const key of options.unset ?? []) {
          if (!['endpoint', 'workspace', 'output'].includes(key)) {
            throw new SimApiError(`Cannot unset "${key}". Use endpoint, workspace, or output.`, 0)
          }
          if (key === 'endpoint' && authProfile !== profile.name) {
            throw new SimApiError(
              `Profile "${profile.name}" shares its endpoint with authentication profile "${authProfile}". Run: sim configure --profile ${authProfile} --unset endpoint`,
              0
            )
          }
          updates[key] = null
        }

        if (Object.keys(updates).length === 0) {
          const current = readConfigProfile(profile.name)
          if (Object.keys(current).length === 0) {
            console.log(chalk.dim(`No settings stored for profile "${profile.name}".`))
            return
          }
          for (const [key, value] of Object.entries(current)) {
            console.log(`${chalk.dim(`${key}:`)} ${value}`)
          }
          return
        }

        writeConfigProfile(profile.name, updates)
        console.log(chalk.green(`✓ Updated profile "${profile.name}" in ${configPath()}`))
      }
    )
}

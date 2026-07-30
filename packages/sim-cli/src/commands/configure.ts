import chalk from 'chalk'
import { Command } from 'commander'
import {
  configPath,
  OUTPUT_FORMATS,
  readConfigProfile,
  writeConfigProfile,
} from '../config/index.js'
import { profileFrom } from '../context.js'
import { SimApiError } from '../http/client.js'

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
        const profile = profileFrom(command)
        const updates: Record<string, string | null> = {}

        if (options.setEndpoint) updates.endpoint = options.setEndpoint.replace(/\/+$/, '')
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

import chalk from 'chalk'
import { Command } from 'commander'
import {
  configPath,
  OUTPUT_FORMATS,
  readConfigProfile,
  resolveAuthenticationProfileName,
  writeConfigProfile,
} from '../config/index'
import {
  normalizeEndpoint,
  normalizeWorkspaceId,
  PROFILE_NAME_PATTERN,
  redact,
} from '../config/profile'
import { globalsOf, profileFrom } from '../context'
import { SimApiError } from '../http/client'

/**
 * The root globals that have a `--set-` twin on this command.
 *
 * `sim configure --endpoint https://x` parses cleanly — the globals are legal
 * anywhere in argv — but `configure` only ever stored its own `--set-` flags, so
 * the value was discarded and the command exited 0 after printing the settings
 * it did not change, which reads exactly like a confirmation. Refusing and
 * naming the twin is the honest answer; making the global write instead would
 * give one command a persistent side effect the same flag has on no other.
 *
 * The suggested command has to carry `--profile` whenever one is selected:
 * without it, a caller who follows the advice verbatim writes the `default`
 * profile and leaves the one they were targeting untouched.
 */
const GLOBAL_FLAG_TWINS = [
  { option: 'endpoint', flag: '--endpoint', setFlag: '--set-endpoint' },
  { option: 'workspace', flag: '-w, --workspace', setFlag: '--set-workspace' },
  { option: 'output', flag: '--output', setFlag: '--set-output' },
] as const

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
/**
 * Quotes a profile name that a pasted command would otherwise split.
 *
 * Profile-name validation is creation-only by design, so a hand-written
 * `[profile my stack]` keeps resolving — and reaches this suggestion carrying
 * whitespace, or a `;` that would end the pasted command and start another.
 * Names that already match the creation rule are left bare, since quoting every
 * one of them would only add noise to the common case.
 */
function quoteProfileArgument(name: string): string {
  const redacted = redact(name)
  if (PROFILE_NAME_PATTERN.test(redacted)) return redacted
  return `'${redacted.replaceAll("'", "'\\''")}'`
}

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
        const globals = globalsOf(command)
        const selectedProfile = globals.profile || process.env.SIM_PROFILE
        const profileArg = selectedProfile
          ? ` --profile ${quoteProfileArgument(selectedProfile)}`
          : ''
        for (const { option, flag, setFlag } of GLOBAL_FLAG_TWINS) {
          const value = globals[option]
          if (value === undefined) continue
          throw new SimApiError(
            `${flag} applies to a single command and is not stored. To save it, run: sim configure${profileArg} ${setFlag} ${redact(value)}`,
            0
          )
        }

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
        if (options.setWorkspace) {
          updates.workspace = normalizeWorkspaceId(options.setWorkspace, '--set-workspace')
        }
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
            throw new SimApiError(
              `Cannot unset "${redact(key)}". Use endpoint, workspace, or output.`,
              0
            )
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

        // An unset against a profile with nothing stored writes nothing — the
        // file layer refuses to conjure a section for a removal — so reporting
        // an update would claim a change that did not happen.
        const removalOnly = Object.values(updates).every((value) => value === null)
        if (removalOnly && Object.keys(readConfigProfile(profile.name)).length === 0) {
          console.log(chalk.dim(`No settings stored for profile "${profile.name}".`))
          return
        }

        writeConfigProfile(profile.name, updates)
        console.log(chalk.green(`✓ Updated profile "${profile.name}" in ${configPath()}`))
      }
    )
}

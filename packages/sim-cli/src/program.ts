import { Command, Option } from 'commander'
import { loginCommand, logoutCommand, profilesCommand, whoamiCommand } from './commands/auth'
import { configureCommand } from './commands/configure'
import { attachCredentialCommands } from './commands/credentials'
import { attachProtocolCommands } from './commands/protocol/index'
import { attachSecretCommands } from './commands/secrets'
import { OUTPUT_FORMATS } from './config/index'
import { SimApiError } from './http/client'
import {
  assertNoReservedProgramFlags,
  buildGeneratedCommands,
  refuseHelpAfterUnknownCommand,
} from './runtime/build'
import { cliVersion } from './version'

/** Root program description, shared by `--help` and the generated docs. */
export const PROGRAM_DESCRIPTION = 'Talk to the Sim API from your terminal'

const WORKBENCH_HELP_EPILOGUE = `
This chat supplies the Sim endpoint, identity and workspace. Files are on the
workbench; relative paths start at /home/user. Save durable artifacts in workspace files.

Start deployed workflows with sim workflows run <id> --async. Use sim_cli for
synchronous draft tests and watch for workflow completion.
`

export const HELP_EPILOGUE = `
Profiles work like the AWS CLI: settings live in ~/.sim/config, keys in
~/.sim/credentials (0600), or under SIM_CONFIG_DIR when it is set. Select one
with -P, --profile, or SIM_PROFILE.

Workflow, knowledge-base and workspace IDs are bare UUIDs. Table IDs carry a
tbl_ prefix and file IDs a wf_ one, so wf_ never names a workflow. An audit-log
or custom-tool ID can open with a dash, which reads as a flag; put -- in front
of it, as in sim audit-logs get -- -HlDcD1z76nK6R4crsUp0.

Examples:
  $ sim login                          Authorize the default profile
  $ sim login --profile dev --endpoint http://localhost:3000
  $ sim profile add acme --workspace 7e2d9c14-6b83-4a55-8f01-c4d3e9a76b28
  $ sim workflows list
  $ sim logs list --level error --limit 20
  $ sim configure --set-output json    Save a profile output default
  $ sim --output json tables get tbl_9f3c1a05d4b7426e8c2f0917ab35de64
  $ sim knowledge search --query "refund policy" --kb 4c1b7f60-2d55-4a3e-9c18-70b6ea2f9d31
  $ sim workflows export 3a9e21d8-5f47-4c0b-b2ea-91d7c6034ef8 > wf.json
  $ sim workflows import --workflow @wf.json
  $ sim whoami --profile dev
`

/** The root's own value-taking options, which consume the token after them. */
const ROOT_VALUE_FLAGS: ReadonlySet<string> = new Set([
  '-P',
  '--profile',
  '--endpoint',
  '-w',
  '--workspace',
  '--output',
])

/**
 * Whether a subcommand was named before the version flag was typed.
 *
 * A bare `--version` carries no value to refuse, so `sim workflows rollback
 * wf_1 --version` still printed the CLI version and exited `0`. What separates
 * it from `sim --version` is not the flag but its position: the first bare word
 * in argv is the command the caller meant to run, and a command that reached
 * this listener does not declare `--version` itself.
 */
function namesASubcommandFirst(rawArgs: readonly string[]): boolean {
  const tokens = rawArgs.slice(2)
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token === '--version' || token === '-V') return false
    if (ROOT_VALUE_FLAGS.has(token)) {
      index += 1
      continue
    }
    if (token.startsWith('-')) continue
    return true
  }
  return false
}

/**
 * The root version flag, declared to accept the value it must refuse.
 *
 * Commander matches the root's own options anywhere in argv, so a plain
 * `-V, --version` was matched inside `sim workflows rollback wf_1 --version 1`
 * before the leaf ever ran: the version printed, the process exited `0`, and no
 * request was made — a rollback that silently did nothing. Taking an optional
 * value here is what makes that case distinguishable, and the listener runs
 * before the one `version()` installs, so a supplied value fails loudly instead
 * of printing a version nobody asked for. The bare form after a subcommand is
 * refused on position for the same reason. `sim --version` on its own is
 * unchanged.
 *
 * The placeholder is `[none]` rather than a value name: the option declares an
 * optional argument only so that a supplied one is visible here, and `--help`
 * has to say that no value is accepted rather than name one.
 */
function addVersionOption(program: Command): void {
  program.on('option:version', (value?: string | null) => {
    if (value === null || value === undefined) {
      // `rawArgs` is commander's own record of the argv it was handed; it is
      // populated before any listener fires but is absent from the typings.
      const { rawArgs } = program as Command & { rawArgs?: string[] }
      if (!namesASubcommandFirst(rawArgs ?? [])) return
      program.error(
        'error: --version reports the Sim CLI version and is not a command flag. A command that acts on a deployment version reads it from --to-version.'
      )
    }
    program.error(
      'error: --version reports the Sim CLI version and takes no value. A command that acts on a deployment version reads it from --to-version.'
    )
  })
  program.version(
    cliVersion(),
    '-V, --version [none]',
    'output the version number (takes no value)'
  )
}

/**
 * Assemble the complete command tree.
 *
 * Kept separate from the entrypoint so the documentation generator can walk the
 * same tree the terminal parses. A generator that rebuilt the surface from the
 * contract instead would be a second implementation of `buildGeneratedCommands`,
 * free to drift from the one users actually run.
 *
 * `version` is optional because the generator reads the package metadata itself
 * and the emitted pages must not carry a version that goes stale on every
 * release.
 */
export function buildProgram(options: { version?: boolean; workbench?: boolean } = {}): Command {
  const program = new Command()

  program.name('sim').description(PROGRAM_DESCRIPTION)

  if (options.version !== false) addVersionOption(program)

  if (!options.workbench) {
    program
      .option('-P, --profile <name>', 'Profile to use (env: SIM_PROFILE)')
      .option('--endpoint <url>', 'Sim deployment to talk to (env: SIM_ENDPOINT)')
      .option('-w, --workspace <id>', 'Workspace to target (env: SIM_WORKSPACE)')
  }
  program.addOption(
    new Option('--output <format>', 'Output format for this command').choices([...OUTPUT_FORMATS])
  )
  const authCommands = options.workbench
    ? [whoamiCommand]
    : [loginCommand, logoutCommand, whoamiCommand, profilesCommand, configureCommand]
  for (const command of authCommands) program.addCommand(command())

  for (const command of buildGeneratedCommands()) {
    program.addCommand(command)
  }

  attachCredentialCommands(program)
  attachProtocolCommands(program)
  attachSecretCommands(program)

  if (options.workbench) {
    program.commands
      .find((command) => command.name() === 'workflows')
      ?.commands.find((command) => command.name() === 'run')
      ?.description(
        'Start a deployed workflow with --async; use sim_cli for draft tests and watch for completion'
      )
    program.hook('preAction', (_root, command) => {
      const path: string[] = []
      for (let current: Command | null = command; current?.parent; current = current.parent) {
        path.unshift(current.name())
      }
      const name = path.join(' ')
      const flags = command.optsWithGlobals()
      if (
        name === 'workflows run' &&
        (flags.async !== true ||
          flags.follow === true ||
          flags.manual === true ||
          flags.trigger ||
          flags.mockPayload === true ||
          flags.fromBlock ||
          flags.run)
      ) {
        throw new SimApiError(
          'Workbench workflow runs must use --async against a deployment. Use sim_cli for synchronous draft tests; use watch with the returned execution id for completion.',
          0
        )
      }
      if (name === 'workflows runs wait' || name === 'logs follow' || path[0] === 'chat') {
        throw new SimApiError(
          'This command waits for remote work. Use watch for workflow completion, or read a current snapshot with workflows runs get / logs list.',
          0
        )
      }
    })
  }

  program.addHelpText('after', options.workbench ? WORKBENCH_HELP_EPILOGUE : HELP_EPILOGUE)

  refuseHelpAfterUnknownCommand(program)
  assertNoReservedProgramFlags(program)

  return program
}

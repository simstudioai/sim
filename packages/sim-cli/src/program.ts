import { Command, Option } from 'commander'
import { loginCommand, logoutCommand, profilesCommand, whoamiCommand } from './commands/auth'
import { configureCommand } from './commands/configure'
import { attachCredentialCommands } from './commands/credentials'
import { attachProtocolCommands } from './commands/protocol/index'
import { attachSecretCommands } from './commands/secrets'
import { OUTPUT_FORMATS } from './config/index'
import { buildGeneratedCommands } from './runtime/build'
import { CLI_VERSION } from './version'

/** Root program description, shared by `--help` and the generated docs. */
export const PROGRAM_DESCRIPTION = 'Talk to the Sim API from your terminal'

export const HELP_EPILOGUE = `
Profiles work like the AWS CLI: settings live in ~/.sim/config, keys in
~/.sim/credentials (0600), or under SIM_CONFIG_DIR when it is set. Select one
with -P, --profile, or SIM_PROFILE.

Examples:
  $ sim login                                    Authorize the default profile
  $ sim profile add acme --workspace ws_123      Reuse that login for a workspace
  $ sim login --profile dev --endpoint http://localhost:3000
  $ sim workflows list
  $ sim logs list --level error --limit 20
  $ sim --output json tables get tbl_123        Override output for one command
  $ sim configure --set-output json             Save a profile output default
  $ sim knowledge search --query "refund policy" --kb kb_123
  $ sim workflows export wf_123 > wf.json        JSON flags read files with @
  $ sim workflows import --workflow @wf.json
  $ sim whoami --profile dev
`

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
export function buildProgram(options: { version?: boolean } = {}): Command {
  const program = new Command()

  program.name('sim').description(PROGRAM_DESCRIPTION)

  if (options.version !== false) program.version(CLI_VERSION)

  program
    .option('-P, --profile <name>', 'Profile to use (env: SIM_PROFILE)')
    .option('--endpoint <url>', 'Sim deployment to talk to (env: SIM_ENDPOINT)')
    .option('-w, --workspace <id>', 'Workspace to target (env: SIM_WORKSPACE)')
    .addOption(
      new Option('--output <format>', 'Output format for this command').choices([...OUTPUT_FORMATS])
    )

  program.addCommand(loginCommand())
  program.addCommand(logoutCommand())
  program.addCommand(whoamiCommand())
  program.addCommand(profilesCommand())
  program.addCommand(configureCommand())

  for (const command of buildGeneratedCommands()) {
    program.addCommand(command)
  }

  attachCredentialCommands(program)
  attachProtocolCommands(program)
  attachSecretCommands(program)

  program.addHelpText('after', HELP_EPILOGUE)

  return program
}

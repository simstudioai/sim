#!/usr/bin/env node

import chalk from 'chalk'
import { Command } from 'commander'
import { loginCommand, logoutCommand, profilesCommand, whoamiCommand } from './commands/auth.js'
import { configureCommand } from './commands/configure.js'
import { attachHandWritten } from './commands/hand-written.js'
import { SimApiError } from './http/client.js'
import { buildGeneratedCommands } from './runtime/build.js'

const program = new Command()

program
  .name('sim')
  .description('Talk to the Sim API from your terminal')
  .version('0.1.0')
  .option('-p, --profile <name>', 'Profile to use (env: SIM_PROFILE)')
  .option('--endpoint <url>', 'Sim deployment to talk to (env: SIM_ENDPOINT)')
  .option('-w, --workspace <id>', 'Workspace to target (env: SIM_WORKSPACE)')

program.addCommand(loginCommand())
program.addCommand(logoutCommand())
program.addCommand(whoamiCommand())
program.addCommand(profilesCommand())
program.addCommand(configureCommand())

/**
 * Leaves owned by hand-written commands, which the generated runtime skips.
 *
 * Each is here because generation genuinely cannot produce it, not because it
 * has not been migrated: `files download` streams binary rather than JSON, and
 * `tables rows list` discovers its columns from user-defined row data at
 * runtime with a nested `data` object the generic renderer would flatten badly.
 */
const HAND_WRITTEN = new Set(['files download', 'tables rows list'])

for (const command of buildGeneratedCommands(HAND_WRITTEN)) {
  program.addCommand(command)
}

// Added after the generated groups so their leaves merge into the same group
// object rather than creating a duplicate top-level command.
attachHandWritten(program)

program.addHelpText(
  'after',
  `
Profiles work like the AWS CLI: settings live in ~/.sim/config, keys in
~/.sim/credentials (0600). Select one with --profile or SIM_PROFILE.

Examples:
  $ sim login                                    Authorize the default profile
  $ sim login --profile dev --endpoint http://localhost:3000
  $ sim workflows list
  $ sim logs list --level error --limit 20
  $ sim configure --set-output json           Output format is a profile setting
  $ sim knowledge search "refund policy" --kb kb_123
  $ sim workflows export wf_123 > wf.json        JSON flags read files with @
  $ sim workflows import --workflow @wf.json
  $ sim whoami --profile dev
`
)

/**
 * Anything the CLI can explain prints as one line and exits 1. An unexpected
 * error keeps its stack trace — that is a bug in the CLI, and hiding it behind a
 * friendly message would make it unreportable.
 */
async function main() {
  try {
    await program.parseAsync(process.argv)
  } catch (error) {
    if (error instanceof SimApiError) {
      console.error(chalk.red(`Error: ${error.message}`))
      if (error.code) console.error(chalk.dim(`  code: ${error.code}`))
      process.exit(1)
    }
    throw error
  }
}

main()

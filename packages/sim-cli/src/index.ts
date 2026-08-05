#!/usr/bin/env node

import chalk from 'chalk'
import { Command, Option } from 'commander'
import { loginCommand, logoutCommand, profilesCommand, whoamiCommand } from './commands/auth.js'
import { configureCommand } from './commands/configure.js'
import { attachProtocolCommands } from './commands/protocol/index.js'
import { OUTPUT_FORMATS, ProfileConfigError } from './config/index.js'
import { formatApiErrorDetails, SimApiError } from './http/client.js'
import { sanitize } from './output/render.js'
import { buildGeneratedCommands } from './runtime/build.js'

const program = new Command()

program
  .name('sim')
  .description('Talk to the Sim API from your terminal')
  .version('0.1.0')
  .option('-p, --profile <name>', 'Profile to use (env: SIM_PROFILE)')
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

attachProtocolCommands(program)

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
  $ sim --output json tables get tbl_123        Override output for one command
  $ sim configure --set-output json             Save a profile output default
  $ sim knowledge search --query "refund policy" --kb kb_123
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
    if (error instanceof ProfileConfigError) {
      console.error(chalk.red(`Error: ${error.message}`))
      process.exit(1)
    }
    if (error instanceof SimApiError) {
      console.error(chalk.red(`Error: ${error.message}`))
      if (error.code) console.error(chalk.dim(`  code: ${error.code}`))
      if (error.details !== undefined) {
        for (const line of formatApiErrorDetails(error.details)) {
          console.error(chalk.dim(sanitize(line)))
        }
      }
      process.exit(1)
    }
    throw error
  }
}

main()

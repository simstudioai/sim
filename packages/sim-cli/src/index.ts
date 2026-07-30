#!/usr/bin/env node

import chalk from 'chalk'
import { Command } from 'commander'
import { loginCommand, logoutCommand, profilesCommand, whoamiCommand } from './commands/auth.js'
import { configureCommand } from './commands/configure.js'
import { filesCommand } from './commands/files.js'
import { knowledgeCommand } from './commands/knowledge.js'
import { logsCommand } from './commands/logs.js'
import { workflowsCommand } from './commands/workflows.js'
import { OUTPUT_FORMATS } from './config/index.js'
import { SimApiError } from './http/client.js'

const program = new Command()

program
  .name('sim')
  .description('Talk to the Sim API from your terminal')
  .version('0.1.0')
  .option('-p, --profile <name>', 'Profile to use (env: SIM_PROFILE)')
  .option('--endpoint <url>', 'Sim deployment to talk to (env: SIM_ENDPOINT)')
  .option('-w, --workspace <id>', 'Workspace to target (env: SIM_WORKSPACE)')
  .option('-o, --output <format>', `Output format: ${OUTPUT_FORMATS.join(' | ')} (env: SIM_OUTPUT)`)

program.addCommand(loginCommand())
program.addCommand(logoutCommand())
program.addCommand(whoamiCommand())
program.addCommand(profilesCommand())
program.addCommand(configureCommand())
program.addCommand(workflowsCommand())
program.addCommand(logsCommand())
program.addCommand(filesCommand())
program.addCommand(knowledgeCommand())

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
  $ sim knowledge search "refund policy" --kb kb_123
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

#!/usr/bin/env node
import chalk from 'chalk'
import { Command } from 'commander'
import updateNotifier from 'update-notifier'
import { help } from './commands/help'
import { start } from './commands/start'
import { version } from './commands/version'
import { config } from './utils/config'
import { logo } from './utils/logo'

// Package info for version checking
const pkg = require('../package.json')

// Check for updates
updateNotifier({ pkg }).notify()

// Create program
const program = new Command()

// Initialize CLI
async function main() {
  // Configure the CLI
  program
    .name('sim')
    .description('Sim Studio CLI')
    .version(pkg.version, '-v, --version', 'Output the current version')
    .helpOption('-h, --help', 'Display help for command')
    .on('--help', () => help())
    .action(() => {
      // Default command (no args) runs start with default options
      start({ port: config.get('port'), debug: config.get('debug') })
    })

  // Start command
  program
    .command('start')
    .description('Start Sim Studio with local storage')
    .option('-p, --port <port>', 'Port to run on', config.get('port'))
    .option('-d, --debug', 'Enable debug mode', config.get('debug'))
    .action((options) => {
      start(options)
    })

  // Version command
  program
    .command('version')
    .description('Show detailed version information')
    .action(() => {
      version()
    })

  // Help command
  program
    .command('help')
    .description('Display help information')
    .action(() => {
      help()
    })

  // Display logo if not in help mode
  if (!process.argv.includes('--help') && !process.argv.includes('-h')) {
    console.log(logo)
  }

  // Parse arguments
  program.parse(process.argv)
}

// Run the CLI
main().catch((error) => {
  console.error(chalk.red('Error:'), error)
  process.exit(1)
})

#!/usr/bin/env bun
import { getErrorMessage } from '@sim/utils/errors'
import { runDoctor } from './doctor.ts'
import { SetupError } from './errors.ts'
import { isLifecycleCommand, runLifecycle } from './lifecycle.ts'
import { exitWith, restoreTerminal } from './terminal.ts'
import { theme } from './theme.ts'
import { runWizard, type WizardMode } from './wizard.ts'

const USAGE = `Usage:
  bun run setup                                run the setup wizard
  bun run sim setup [--quick] [--mode compose|dev|k8s]
  bun run sim doctor [--fix] [--json]          check your setup
  bun run sim start | stop | restart           bring your install up / down / cycle
  bun run sim status                           what's installed and healthy
  bun run sim logs                             follow logs
  bun run sim down                             remove containers (data kept)
  bun run sim reset                            archive .env + wipe managed data

Prefer a bare "sim"? Run "bun link" once, then ensure ~/.bun/bin is on your
PATH (Homebrew's bun doesn't add it): export PATH="$HOME/.bun/bin:$PATH".`

function parseMode(value: string | undefined): WizardMode {
  if (value === 'compose' || value === 'dev' || value === 'k8s') return value
  throw new Error(`invalid --mode "${value}" — expected compose, dev, or k8s`)
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE)
    return
  }
  process.on('SIGINT', () => exitWith(130))

  const command = args[0]

  // Bare `sim` prints help; the wizard is `sim setup` (or `bun run setup`).
  if (!command) {
    console.log(USAGE)
    return
  }

  if (command === 'doctor') {
    process.exitCode = await runDoctor({
      fix: args.includes('--fix'),
      json: args.includes('--json'),
    })
    return
  }

  if (isLifecycleCommand(command)) {
    await runLifecycle(command)
    return
  }

  if (command === 'setup') {
    const setupArgs = args.slice(1)
    const modeIdx = setupArgs.indexOf('--mode')
    await runWizard({
      quick: setupArgs.includes('--quick'),
      mode: modeIdx === -1 ? undefined : parseMode(setupArgs[modeIdx + 1]),
    })
    return
  }

  console.error(`Unknown command: ${command}\n`)
  console.log(USAGE)
  process.exitCode = 1
}

function renderFailure(error: unknown): void {
  const hints = error instanceof SetupError ? error.hints : []
  console.error()
  console.error(`${theme.error('✗ Setup failed')}\n`)
  console.error(`  ${getErrorMessage(error).split('\n').join('\n  ')}`)
  if (hints.length > 0) {
    console.error(`\n  ${theme.heading('Try:')}`)
    for (const hint of hints) {
      console.error(`   ${theme.muted('•')} ${hint}`)
    }
  }
  console.error(
    `\n  ${theme.muted('Your progress is saved — re-run')} ${theme.command('bun run setup')} ${theme.muted('to pick up where you left off.')}`
  )
}

main()
  .catch((error) => {
    renderFailure(error)
    process.exitCode = 1
  })
  .finally(restoreTerminal)

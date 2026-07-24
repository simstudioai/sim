#!/usr/bin/env bun
import { getErrorMessage } from '@sim/utils/errors'
import { runDoctor } from './doctor.ts'
import { SetupError } from './errors.ts'
import { isLifecycleCommand, runLifecycle } from './lifecycle.ts'
import { exitWith, restoreTerminal } from './terminal.ts'
import { theme } from './theme.ts'
import { runWizard, type WizardMode } from './wizard.ts'

const USAGE = `Usage:
  sim                                    run the setup wizard
  sim setup [--quick] [--mode compose|dev|k8s]
  sim doctor [--fix] [--json]            check your setup
  sim start | stop | restart             bring your install up / down / cycle
  sim status                             what's installed and healthy
  sim logs                               follow logs
  sim down                               remove containers (data kept)
  sim reset                              archive .env + wipe managed data

Not linked yet? Prefix with "bun run" (e.g. bun run sim status), or run
"bun link" once so "sim" works anywhere.`

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

  if (command === 'doctor') {
    process.exitCode = await runDoctor({
      fix: args.includes('--fix'),
      json: args.includes('--json'),
    })
    return
  }

  if (command && isLifecycleCommand(command)) {
    await runLifecycle(command)
    return
  }

  // Anything else that looks like a command (not a flag, not `setup`) is a typo.
  if (command && !command.startsWith('-') && command !== 'setup') {
    console.error(`Unknown command: ${command}\n`)
    console.log(USAGE)
    process.exitCode = 1
    return
  }

  // Bare invocation and `setup` both run the wizard; strip the optional keyword.
  const setupArgs = command === 'setup' ? args.slice(1) : args
  const modeIdx = setupArgs.indexOf('--mode')
  await runWizard({
    quick: setupArgs.includes('--quick'),
    mode: modeIdx === -1 ? undefined : parseMode(setupArgs[modeIdx + 1]),
  })
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

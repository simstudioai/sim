#!/usr/bin/env bun
import { getErrorMessage } from '@sim/utils/errors'
import { runDoctor } from './doctor.ts'
import { SetupError } from './errors.ts'
import { exitWith, restoreTerminal } from './terminal.ts'
import { theme } from './theme.ts'
import { runWizard, type WizardMode } from './wizard.ts'

const USAGE = `Usage:
  bun run setup [--quick] [--mode compose|dev|k8s]
  bun run doctor [--fix] [--json]`

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

  if (args[0] === 'doctor') {
    process.exitCode = await runDoctor({
      fix: args.includes('--fix'),
      json: args.includes('--json'),
    })
    return
  }

  const modeIdx = args.indexOf('--mode')
  await runWizard({
    quick: args.includes('--quick'),
    mode: modeIdx === -1 ? undefined : parseMode(args[modeIdx + 1]),
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

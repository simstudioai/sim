#!/usr/bin/env node
import { getErrorMessage } from '@sim/utils/errors'
import { parseSetupArguments, SetupArgumentError } from './arguments'
import { SetupError } from './errors'
import { exitWith, restoreTerminal } from './terminal'
import { theme } from './theme'
import { SETUP_VERSION } from './version'

const SETUP_FEATURES =
  'email | storage | sandbox | jobs | cache | knowledge | knowledge-embeddings | chat | llm | integration <slug>'

const USAGE = `Usage:
  sim-setup [--quick] [--dir <path>] [--mode compose|dev|k8s]
  sim-setup config                         show configured capabilities and integrations
  sim-setup add <feature>                  configure ${SETUP_FEATURES}
  sim-setup desktop [--url <url>]          install the macOS desktop app against this deployment
  sim-setup doctor [--fix] [--json]        check your setup
  sim-setup start | stop | restart         bring your install up / down / cycle
  sim-setup update                         pull/rebuild and apply Compose images
  sim-setup status                         show what's installed and healthy
  sim-setup logs                           follow logs
  sim-setup down                           remove containers (data kept)
  sim-setup reset                          archive .env + wipe managed data

Note: dev and k8s modes require a Sim source checkout.`

async function main(): Promise<void> {
  const invocation = parseSetupArguments(process.argv.slice(2))
  if (invocation.kind === 'version') {
    console.log(SETUP_VERSION)
    return
  }
  if (invocation.kind === 'help') {
    console.log(USAGE)
    return
  }
  process.on('SIGINT', () => exitWith(130))

  if (invocation.kind === 'config') {
    const { runSetupStatus } = await import('./setup-status')
    process.exitCode = await runSetupStatus()
    return
  }

  if (invocation.kind === 'add') {
    const { runFeatureSetup } = await import('./feature-setup')
    await runFeatureSetup(invocation.feature, invocation.args)
    return
  }

  if (invocation.kind === 'desktop') {
    const { runDesktop } = await import('./desktop')
    process.exitCode = await runDesktop({ url: invocation.url, noOpen: invocation.noOpen })
    return
  }

  if (invocation.kind === 'doctor') {
    const { runDoctor } = await import('./doctor')
    process.exitCode = await runDoctor({ fix: invocation.fix, json: invocation.json })
    return
  }

  if (invocation.kind === 'lifecycle') {
    const { runLifecycle } = await import('./lifecycle')
    await runLifecycle(invocation.command)
    return
  }

  if (invocation.kind === 'wizard') {
    const { runWizard } = await import('./wizard')
    await runWizard({ quick: invocation.quick, mode: invocation.mode })
    return
  }
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
    `\n  ${theme.muted('Your progress is saved — re-run')} ${theme.command('npx sim-setup')} ${theme.muted('to pick up where you left off.')}`
  )
}

main()
  .catch((error) => {
    if (error instanceof SetupArgumentError) {
      console.error(`Error: ${error.message}\n`)
      console.error(USAGE)
    } else {
      renderFailure(error)
    }
    process.exitCode = 1
  })
  .finally(restoreTerminal)

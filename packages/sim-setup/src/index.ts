#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { getErrorMessage } from '@sim/utils/errors'
import { SetupError } from './errors'
import { exitWith, restoreTerminal } from './terminal'
import { theme } from './theme'

type WizardMode = 'compose' | 'dev' | 'k8s'

const LIFECYCLE_COMMANDS = [
  'start',
  'stop',
  'restart',
  'update',
  'status',
  'logs',
  'down',
  'reset',
] as const
type LifecycleCommand = (typeof LIFECYCLE_COMMANDS)[number]
const SETUP_FEATURES =
  'email | storage | sandbox | jobs | cache | knowledge | knowledge-embeddings | llm | integration <slug>'

function isLifecycleCommand(value: string | undefined): value is LifecycleCommand {
  return Boolean(value && (LIFECYCLE_COMMANDS as readonly string[]).includes(value))
}

const USAGE = `Usage:
  npx @sim/setup                             run the setup wizard
  npx @sim/setup [--quick] [--dir <path>]    create a Compose installation
  npx @sim/setup config                      show configured capabilities and integrations
  npx @sim/setup add <feature>               configure ${SETUP_FEATURES}
  npx @sim/setup doctor [--fix] [--json]     check your setup
  npx @sim/setup start | stop | restart      bring your install up / down / cycle
  npx @sim/setup update                      pull and apply Compose images
  npx @sim/setup status                      show what's installed and healthy
  npx @sim/setup logs                        follow logs
  npx @sim/setup down                        remove containers (data kept)
  npx @sim/setup reset                       archive .env + wipe managed data

Inside a Sim source checkout, use the repository command:
  bun run sim-setup [--quick] [--mode compose|dev|k8s]
  bun run sim-setup config                      show configured capabilities and integrations
  bun run sim-setup add <feature>                configure ${SETUP_FEATURES}
  bun run sim-setup doctor [--fix] [--json]      check your setup
  bun run sim-setup start | stop | restart       bring your install up / down / cycle
  bun run sim-setup update                       pull/rebuild and apply Compose images
  bun run sim-setup status                       what's installed and healthy
  bun run sim-setup logs                         follow logs
  bun run sim-setup down                         remove containers (data kept)
  bun run sim-setup reset                        archive .env + wipe managed data`

function readPackageVersion(): string {
  const metadata: unknown = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8')
  )
  if (
    typeof metadata !== 'object' ||
    metadata === null ||
    !('version' in metadata) ||
    typeof metadata.version !== 'string'
  ) {
    throw new Error('@sim/setup package metadata is missing a valid version')
  }
  return metadata.version
}

function withoutDirectoryOption(args: readonly string[]): string[] {
  const filtered: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg.startsWith('--dir=')) continue
    if (arg === '--dir') {
      index += 1
      continue
    }
    filtered.push(arg)
  }
  return filtered
}

function parseMode(value: string | undefined): WizardMode {
  if (value === 'compose' || value === 'dev' || value === 'k8s') return value
  throw new Error(`invalid --mode "${value}" — expected compose, dev, or k8s`)
}

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2)
  if (rawArgs.includes('--version') || rawArgs.includes('-V')) {
    console.log(readPackageVersion())
    return
  }
  const args = withoutDirectoryOption(rawArgs)
  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE)
    return
  }
  process.on('SIGINT', () => exitWith(130))

  const command = args[0]

  if (command === 'config') {
    const { runSetupStatus } = await import('./setup-status')
    process.exitCode = await runSetupStatus()
    return
  }

  if (command === 'add') {
    const feature = args[1]
    if (!feature || feature.startsWith('-')) {
      throw new Error(`Missing feature. Expected: ${SETUP_FEATURES}`)
    }
    const { runFeatureSetup } = await import('./feature-setup')
    await runFeatureSetup(feature, args.slice(2))
    return
  }

  if (command === 'doctor') {
    const { runDoctor } = await import('./doctor')
    process.exitCode = await runDoctor({
      fix: args.includes('--fix'),
      json: args.includes('--json'),
    })
    return
  }

  if (isLifecycleCommand(command)) {
    const { runLifecycle } = await import('./lifecycle')
    await runLifecycle(command)
    return
  }

  if (!command || command.startsWith('-')) {
    const modeIdx = args.indexOf('--mode')
    const { runWizard } = await import('./wizard')
    await runWizard({
      quick: args.includes('--quick'),
      mode: modeIdx === -1 ? undefined : parseMode(args[modeIdx + 1]),
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
    `\n  ${theme.muted('Your progress is saved — re-run')} ${theme.command('npx @sim/setup')} ${theme.muted('to pick up where you left off.')}`
  )
}

main()
  .catch((error) => {
    renderFailure(error)
    process.exitCode = 1
  })
  .finally(restoreTerminal)

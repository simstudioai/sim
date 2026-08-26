export type WizardMode = 'compose' | 'dev' | 'k8s'

export const LIFECYCLE_COMMANDS = [
  'start',
  'stop',
  'restart',
  'update',
  'status',
  'logs',
  'down',
  'reset',
] as const

export type LifecycleCommand = (typeof LIFECYCLE_COMMANDS)[number]

export type SetupInvocation =
  | { kind: 'help' }
  | { kind: 'version' }
  | { kind: 'wizard'; quick: boolean; mode?: WizardMode }
  | { kind: 'config' }
  | { kind: 'add'; feature: string; args: string[] }
  | { kind: 'doctor'; fix: boolean; json: boolean }
  | { kind: 'desktop'; url?: string; noOpen: boolean }
  | { kind: 'lifecycle'; command: LifecycleCommand }

export class SetupArgumentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SetupArgumentError'
  }
}

function isLifecycleCommand(value: string | undefined): value is LifecycleCommand {
  return Boolean(value && (LIFECYCLE_COMMANDS as readonly string[]).includes(value))
}

function fail(message: string): never {
  throw new SetupArgumentError(message)
}

function stripDirectoryOption(args: readonly string[]): string[] {
  const filtered: string[] = []
  let found = false

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--dir' || arg.startsWith('--dir=')) {
      if (found) fail('--dir may only be provided once')
      found = true

      if (arg === '--dir') {
        const value = args[index + 1]
        if (!value || value.startsWith('-')) fail('--dir requires a directory path')
        index += 1
      } else if (!arg.slice('--dir='.length)) {
        fail('--dir requires a directory path')
      }
      continue
    }
    filtered.push(arg)
  }

  return filtered
}

function oneFlag(args: readonly string[], flag: string): boolean {
  const count = args.filter((arg) => arg === flag).length
  if (count > 1) fail(`${flag} may only be provided once`)
  return count === 1
}

function parseMode(args: readonly string[]): { mode?: WizardMode; remaining: string[] } {
  let mode: WizardMode | undefined
  const remaining: string[] = []

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg !== '--mode' && !arg.startsWith('--mode=')) {
      remaining.push(arg)
      continue
    }
    if (mode) fail('--mode may only be provided once')

    const value = arg === '--mode' ? args[++index] : arg.slice('--mode='.length)
    if (value !== 'compose' && value !== 'dev' && value !== 'k8s') {
      fail(`invalid --mode "${value ?? ''}" — expected compose, dev, or k8s`)
    }
    mode = value
  }

  return { mode, remaining }
}

function expectNoArguments(command: string, args: readonly string[]): void {
  if (args.length > 0) fail(`${command} does not accept: ${args.join(' ')}`)
}

function parseCore(
  args: readonly string[],
  helpRequested: boolean
): Exclude<SetupInvocation, { kind: 'help' | 'version' }> {
  const command = args[0]

  if (!command || command.startsWith('-')) {
    const quick = oneFlag(args, '--quick')
    const withoutQuick = args.filter((arg) => arg !== '--quick')
    const { mode, remaining } = parseMode(withoutQuick)
    if (remaining.length > 0) fail(`Unknown setup option: ${remaining[0]}`)
    return { kind: 'wizard', quick, ...(mode ? { mode } : {}) }
  }

  const commandArgs = args.slice(1)
  if (command === 'config') {
    expectNoArguments(command, commandArgs)
    return { kind: 'config' }
  }

  if (command === 'add') {
    const feature = commandArgs[0]
    if (!feature) {
      if (helpRequested) return { kind: 'add', feature: '', args: [] }
      fail('add requires a feature')
    }
    if (feature.startsWith('-')) fail(`Unknown add option: ${feature}`)

    const featureArgs = commandArgs.slice(1)
    if (feature === 'integration') {
      if (featureArgs.length === 0 && helpRequested) {
        return { kind: 'add', feature, args: [] }
      }
      if (featureArgs.length !== 1 || featureArgs[0].startsWith('-')) {
        fail('add integration requires exactly one integration slug')
      }
    } else if (featureArgs.length > 0) {
      fail(`add ${feature} does not accept: ${featureArgs.join(' ')}`)
    }
    return { kind: 'add', feature, args: featureArgs }
  }

  if (command === 'desktop') {
    const noOpen = oneFlag(commandArgs, '--no-open')
    let url: string | undefined
    const remaining: string[] = []
    for (let index = 0; index < commandArgs.length; index += 1) {
      const arg = commandArgs[index]
      if (arg === '--no-open') continue
      if (arg !== '--url' && !arg.startsWith('--url=')) {
        remaining.push(arg)
        continue
      }
      if (url) fail('--url may only be provided once')
      const value = arg === '--url' ? commandArgs[++index] : arg.slice('--url='.length)
      if (!value || value.startsWith('-')) fail('--url requires a deployment URL')
      url = value
    }
    if (remaining.length > 0) fail(`Unknown desktop option: ${remaining[0]}`)
    return { kind: 'desktop', noOpen, ...(url ? { url } : {}) }
  }

  if (command === 'doctor') {
    const fix = oneFlag(commandArgs, '--fix')
    const json = oneFlag(commandArgs, '--json')
    const remaining = commandArgs.filter((arg) => arg !== '--fix' && arg !== '--json')
    if (remaining.length > 0) fail(`Unknown doctor option: ${remaining[0]}`)
    return { kind: 'doctor', fix, json }
  }

  if (isLifecycleCommand(command)) {
    expectNoArguments(command, commandArgs)
    return { kind: 'lifecycle', command }
  }

  fail(`Unknown command: ${command}`)
}

/** Parses and validates the complete public command surface before any setup work begins. */
export function parseSetupArguments(rawArgs: readonly string[]): SetupInvocation {
  const args = stripDirectoryOption(rawArgs)
  const helpCount = args.filter((arg) => arg === '--help' || arg === '-h').length
  if (helpCount > 1) fail('--help may only be provided once')
  const versionCount = args.filter((arg) => arg === '--version' || arg === '-V').length
  if (versionCount > 1) fail('--version may only be provided once')
  if (helpCount > 0 && versionCount > 0) fail('--help and --version cannot be combined')

  if (versionCount === 1) {
    const remaining = args.filter((arg) => arg !== '--version' && arg !== '-V')
    expectNoArguments('--version', remaining)
    return { kind: 'version' }
  }

  const helpRequested = helpCount === 1
  const withoutHelp = args.filter((arg) => arg !== '--help' && arg !== '-h')
  const invocation = parseCore(withoutHelp, helpRequested)
  return helpRequested ? { kind: 'help' } : invocation
}

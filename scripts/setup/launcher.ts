#!/usr/bin/env bun

interface ModuleResolutionError {
  code?: unknown
  message?: unknown
}

function asModuleResolutionError(error: unknown): ModuleResolutionError | null {
  return typeof error === 'object' && error !== null ? error : null
}

/** Identifies dependency-resolution failures without masking setup/configuration errors. */
export function isMissingDependencyError(error: unknown): boolean {
  const candidate = asModuleResolutionError(error)
  if (candidate?.code !== 'ERR_MODULE_NOT_FOUND' && candidate?.code !== 'MODULE_NOT_FOUND') {
    return false
  }
  return (
    typeof candidate.message === 'string' &&
    /Cannot find (?:package|module) ['"][^./][^'"]*['"]/.test(candidate.message)
  )
}

/** Reconstructs the public command instead of exposing the internal launcher path. */
export function retrySetupCommand(args: readonly string[]): string {
  if (args[0] === 'setup') return ['bun run setup', ...args.slice(1)].join(' ')
  return ['bun run sim', ...args].join(' ')
}

export function missingDependenciesMessage(retryCommand: string): string {
  return [
    '',
    '✗ Setup dependencies are missing or out of date.',
    '',
    '  Run: bun install',
    `  Then retry: ${retryCommand}`,
  ].join('\n')
}

export async function launchSetupCli(
  args: readonly string[] = process.argv.slice(2)
): Promise<void> {
  try {
    await import('./index.ts')
  } catch (error) {
    if (!isMissingDependencyError(error)) throw error
    console.error(missingDependenciesMessage(retrySetupCommand(args)))
    process.exitCode = 1
  }
}

if (import.meta.main) await launchSetupCli()

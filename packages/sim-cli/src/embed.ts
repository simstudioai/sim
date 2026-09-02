import { ProfileConfigError } from './config/index'
import {
  type EmbedContext,
  type EmbeddedCliIdentity,
  EmbeddedExit,
  embedStore,
  installEmbedSinks,
} from './embed-context'
import {
  formatApiErrorDetails,
  isRequestTimeout,
  RAISE_TIMEOUT_HINT,
  SimApiError,
  SimClient,
} from './http/client'
import { sanitize } from './output/render'
import { buildProgram } from './program'

/**
 * In-process execution of one CLI invocation, for a server that already knows
 * who is calling: the caller supplies endpoint + credential + workspace
 * directly and the profile machinery (config files, env vars, login state) is
 * bypassed entirely. Everything else — command tree, flag parsing, request
 * building, output rendering — is the exact code the installed CLI runs, so
 * the two surfaces cannot drift.
 *
 * Concurrency-safe by construction: the identity and the output capture both
 * live in an AsyncLocalStorage context, so parallel embedded invocations (and
 * any ordinary console logging around them) never interleave.
 */

export type { EmbeddedCliIdentity } from './embed-context'
export type {
  ExportWorkflowResponse,
  ListFilesResponse,
  ListWorkflowsResponse,
  ReadFileTextResponse,
} from './generated/v2-api'
export { SimClient } from './http/client'

export interface EmbeddedCliResult {
  exitCode: number
  stdout: string
  stderr: string
}

/**
 * A typed v2 client bound to an embedded identity — for server-side augmentation
 * commands that reuse the v2 surface directly instead of re-parsing rendered
 * CLI output. Same endpoint/credential semantics as {@link runEmbeddedCli}.
 */
export function createEmbeddedClient(identity: EmbeddedCliIdentity): SimClient {
  return new SimClient({
    name: 'embedded',
    endpoint: identity.endpoint,
    apiKey: identity.apiKey,
    workspaceId: identity.workspaceId ?? null,
    output: 'json',
    sources: { endpoint: 'flag', apiKey: 'flag', workspaceId: 'flag', output: 'flag' },
  })
}

/**
 * Runs one CLI invocation in-process. `argv` is the token list exactly as the
 * terminal would receive it (no leading node/binary tokens). Errors the
 * installed CLI would print-and-exit-1 on come back the same way: rendered to
 * stderr, exitCode 1 — never thrown.
 */
export async function runEmbeddedCli(
  argv: string[],
  identity: EmbeddedCliIdentity,
  options?: { fileArguments?: Record<string, string>; writeFile?: EmbedContext['writeFile'] }
): Promise<EmbeddedCliResult> {
  installEmbedSinks()
  const ctx: EmbedContext = {
    identity,
    stdout: [],
    stderr: [],
    ...(options?.fileArguments ? { fileArguments: options.fileArguments } : {}),
    ...(options?.writeFile ? { writeFile: options.writeFile } : {}),
  }
  return embedStore.run(ctx, async () => {
    let exitCode = 0
    try {
      const program = buildProgram()
      program.exitOverride()
      await program.parseAsync(argv, { from: 'user' })
      // Commands that soft-fail (a failed run outcome, wait timeout) report through the
      // context via setSoftExitCode — never process.exitCode, which is shared and raced
      // between parallel embedded invocations.
      if (ctx.softExitCode !== undefined && ctx.softExitCode !== 0) exitCode = ctx.softExitCode
    } catch (error) {
      exitCode = renderEmbeddedError(ctx, error)
    }
    return { exitCode, stdout: ctx.stdout.join('\n'), stderr: ctx.stderr.join('\n') }
  })
}

/** Mirrors the installed CLI's top-level error handling (src/index.ts), minus process.exit. */
function renderEmbeddedError(ctx: EmbedContext, error: unknown): number {
  if (error instanceof EmbeddedExit) return error.code
  if (error && typeof error === 'object' && 'exitCode' in error && 'code' in error) {
    // commander's CommanderError from exitOverride: usage/parse errors already
    // printed through the (captured) output; help/version exit 0.
    const commander = error as { exitCode: number; code: string }
    if (commander.code === 'commander.helpDisplayed' || commander.code === 'commander.version') {
      return 0
    }
    return commander.exitCode || 1
  }
  if (error instanceof ProfileConfigError) {
    ctx.stderr.push(`Error: ${sanitize(error.message)}`)
    return 1
  }
  if (isRequestTimeout(error)) {
    ctx.stderr.push(`Error: the request timed out. ${RAISE_TIMEOUT_HINT}`)
    return 1
  }
  if (error instanceof SimApiError) {
    ctx.stderr.push(`Error: ${sanitize(error.message)}`)
    if (error.code) ctx.stderr.push(`  code: ${sanitize(error.code)}`)
    if (error.details !== undefined) {
      for (const line of formatApiErrorDetails(error.details)) ctx.stderr.push(sanitize(line))
    }
    return 1
  }
  ctx.stderr.push(`Error: ${sanitize(error instanceof Error ? error.message : String(error))}`)
  return 1
}

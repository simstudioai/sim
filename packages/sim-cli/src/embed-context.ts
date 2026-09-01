import { AsyncLocalStorage } from 'node:async_hooks'
import type { ResolvedProfile } from './config/profile'

/**
 * The async-context plumbing for embedded (in-process) CLI runs, split from
 * `embed.ts` so `config/profile.ts` can consult it without a runtime import
 * cycle (this module imports nothing from the CLI beyond a type).
 */

export interface EmbeddedCliIdentity {
  endpoint: string
  apiKey: string
  workspaceId?: string
}

export interface EmbedContext {
  identity: EmbeddedCliIdentity
  stdout: string[]
  stderr: string[]
  /**
   * Pre-read contents for `@path` file arguments, keyed by the path as written
   * (without the `@`). The host resolves these from the caller's own file
   * surface before the run; the in-process CLI never touches the server's
   * filesystem.
   */
  fileArguments?: Record<string, string>
}

export const embedStore = new AsyncLocalStorage<EmbedContext>()

/** Thrown in place of process.exit inside an embedded run. */
export class EmbeddedExit extends Error {
  constructor(readonly code: number) {
    super(`CLI exited with code ${code}`)
  }
}

/**
 * The profile resolver consults this before touching env or config files: an
 * embedded run's identity comes entirely from the hosting server (it already
 * authenticated the caller and knows the workspace), never from profiles,
 * login state, or the host process env. Null outside an embedded run, which
 * keeps the installed CLI's behavior byte-identical.
 */
export function embeddedProfile(): ResolvedProfile | null {
  const ctx = embedStore.getStore()
  if (!ctx) return null
  return {
    name: 'embedded',
    endpoint: ctx.identity.endpoint,
    apiKey: ctx.identity.apiKey,
    workspaceId: ctx.identity.workspaceId ?? null,
    output: 'json',
    sources: { endpoint: 'flag', apiKey: 'flag', workspaceId: 'flag', output: 'flag' },
  }
}

let sinksInstalled = false

/**
 * Output and process.exit shims, installed once, active only inside an embedded
 * run's async context. The CLI renders through console.log/error, commander and
 * chalk write straight to process.stdout/stderr, and a few commands exit
 * directly; all of it must land in the embed result instead of the host
 * server's stdout (or worse, the host process's lifetime).
 */
export function installEmbedSinks(): void {
  if (sinksInstalled) return
  sinksInstalled = true
  const originalLog = console.log.bind(console)
  const originalError = console.error.bind(console)
  const originalExit = process.exit.bind(process)
  const originalStdoutWrite = process.stdout.write.bind(process.stdout)
  const originalStderrWrite = process.stderr.write.bind(process.stderr)
  console.log = (...args: unknown[]) => {
    const ctx = embedStore.getStore()
    if (ctx) {
      ctx.stdout.push(args.map(String).join(' '))
      return
    }
    originalLog(...args)
  }
  console.error = (...args: unknown[]) => {
    const ctx = embedStore.getStore()
    if (ctx) {
      ctx.stderr.push(args.map(String).join(' '))
      return
    }
    originalError(...args)
  }
  process.stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
    const ctx = embedStore.getStore()
    if (ctx) {
      ctx.stdout.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'))
      const callback = rest.find((a) => typeof a === 'function') as (() => void) | undefined
      callback?.()
      return true
    }
    return originalStdoutWrite(chunk as never, ...(rest as never[]))
  }) as typeof process.stdout.write
  process.stderr.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
    const ctx = embedStore.getStore()
    if (ctx) {
      ctx.stderr.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'))
      const callback = rest.find((a) => typeof a === 'function') as (() => void) | undefined
      callback?.()
      return true
    }
    return originalStderrWrite(chunk as never, ...(rest as never[]))
  }) as typeof process.stderr.write
  process.exit = ((code?: number) => {
    const ctx = embedStore.getStore()
    if (ctx) throw new EmbeddedExit(code ?? 0)
    return originalExit(code)
  }) as typeof process.exit
}

import { AsyncLocalStorage } from 'node:async_hooks'
import type { ResolvedProfile } from './config/profile'
import type { EmbeddedOutput } from './embed-output'

/**
 * The async-context plumbing for embedded (in-process) CLI runs, split from
 * `embed.ts` so `config/profile.ts` can consult it without a runtime import
 * cycle (this module imports nothing from the CLI beyond a type).
 */

export interface EmbeddedCliIdentity {
  endpoint: string
  apiKey: string
  workspaceId?: string
  /**
   * How requests reach the endpoint. A host that serves the v2 routes itself passes a
   * transport that dispatches to them in-process, so an embedded run never leaves the
   * server: no network hop, no proxy body ceiling, no per-key rate limit meant for
   * callers on the wire. Absent, requests go over `fetch` like the installed CLI's.
   */
  transport?: typeof fetch
  /** Cancellation belongs to this invocation, never to the hosting process. */
  signal?: AbortSignal
}

/** A host-owned immutable file, streamed once and released when the invocation ends. */
export interface EmbeddedFileSnapshot {
  size: number
  /** The host's read lease also bounds outstanding upload requests. */
  signal?: AbortSignal
  stream(): Promise<ReadableStream<Uint8Array>>
  dispose(): Promise<void>
}

export interface EmbedContext {
  identity: EmbeddedCliIdentity
  stdout: EmbeddedOutput
  stderr: EmbeddedOutput
  /**
   * Reads bounded structured arguments from the caller's machine on demand.
   * The CLI owns path syntax; the host receives the resolved path without `@`.
   * An embedded invocation never falls back to the server's filesystem.
   */
  readFile?: (path: string) => Promise<string | Uint8Array>
  /** File transfers use a snapshot; structured arguments use the separate bounded reader. */
  openFile?: (path: string) => Promise<EmbeddedFileSnapshot>
  /**
   * Soft-fail exit code (a failed run outcome, `runs wait` timeout). Embedded
   * commands write here INSTEAD of process.exitCode: that global is shared, so
   * two parallel embedded invocations raced on it — one run could observe and
   * clear another's failure.
   */
  softExitCode?: number
  /**
   * Where a download lands when embedded: the host writes to the caller's own machine
   * (through its file adapter), never to the server's disk. Resolves only after publication;
   * a refused or uncertain write throws. The host consumes or cancels the stream;
   * it must not buffer the complete download. Overwrite policy must hold atomically.
   */
  writeFile?: (
    path: string,
    content: ReadableStream<Uint8Array>,
    options: { overwrite: boolean }
  ) => Promise<void>
}

/** The embedded-vs-standalone seam for soft-fail codes: context when embedded, global otherwise. */
export function setSoftExitCode(code: number): void {
  const ctx = embedStore.getStore()
  if (ctx) ctx.softExitCode = code
  else process.exitCode = code
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
    ...(ctx.identity.transport ? { transport: ctx.identity.transport } : {}),
    ...(ctx.identity.signal ? { signal: ctx.identity.signal } : {}),
    sources: { endpoint: 'flag', apiKey: 'flag', workspaceId: 'flag', output: 'flag' },
  }
}

/** Exits the terminal CLI without terminating an embedding host. */
export function exitCli(code: number): never {
  if (embedStore.getStore()) throw new EmbeddedExit(code)
  return process.exit(code)
}

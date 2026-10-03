import { AsyncLocalStorage } from 'node:async_hooks'
import type { DurableSecretProvenance } from '@/lib/execution/durable-secret-provenance'
import type { SessionProcessIdentity } from '@/lib/execution/remote-sandbox/session-process'

interface SandboxExecutionObserver {
  sessionInputProvenance?(): boolean | DurableSecretProvenance
  hold(work: Promise<unknown>): void
  unsettled(processId?: string): void
  claimProcess?(process: SessionProcessIdentity): Promise<void>
  settleProcess?(processId: string): Promise<void>
  sessionAccess?(sessionKey: string, signal: AbortSignal): Promise<void>
}

const executionObserver = new AsyncLocalStorage<SandboxExecutionObserver>()

/** Keeps cancellation uncertainty attached to its caller across internal tool adapters. */
export function observeSandboxExecution<T>(
  observer: SandboxExecutionObserver,
  execute: () => T
): T {
  return executionObserver.run(observer, execute)
}

/** A caller may return on abort while this underlying operation still owns resources. */
export function retainSandboxExecution(work: Promise<unknown>): void {
  executionObserver.getStore()?.hold(work)
}

/** A rejected transport or failed kill is not proof that its remote process ended. */
export function reportUnsettledSandboxProcess(processId?: string): void {
  executionObserver.getStore()?.unsettled(processId)
}

export async function recordSandboxProcess(process: SessionProcessIdentity): Promise<void> {
  await executionObserver.getStore()?.claimProcess?.(process)
}

export async function settleSandboxProcess(processId: string): Promise<void> {
  await executionObserver.getStore()?.settleProcess?.(processId)
}

/** The caller checks prior execution ownership before touching a persistent workbench. */
export async function prepareSandboxSessionAccess(
  sessionKey: string,
  signal: AbortSignal
): Promise<void> {
  signal.throwIfAborted()
  await executionObserver.getStore()?.sessionAccess?.(sessionKey, signal)
  signal.throwIfAborted()
}

/** The trusted tool adapter supplies current input evidence while preserving execution ownership. */
export function observeSandboxSessionInputs<T>(
  safe: () => boolean | DurableSecretProvenance,
  execute: () => T
): T {
  const current = executionObserver.getStore()
  return executionObserver.run(
    {
      hold: (work) => current?.hold(work),
      unsettled: (id) => current?.unsettled(id),
      ...current,
      sessionInputProvenance: safe,
    },
    execute
  )
}

/** Trusted input evidence is sampled immediately before the machine receives the bytes. */
export function sandboxSessionInputProvenance(): DurableSecretProvenance {
  const value = executionObserver.getStore()?.sessionInputProvenance?.()
  if (typeof value === 'object') return value
  return value === true ? { status: 'exact', entries: [] } : { status: 'unknown' }
}

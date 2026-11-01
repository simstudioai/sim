import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { createSandboxPricing } from '@/lib/billing/sandbox-pricing'
import { mapSettledWithConcurrency } from '@/lib/core/utils/concurrency'
import { type CreatedSandbox, createSelectedSandbox } from '@/lib/execution/remote-sandbox/create'
import { resolveProvider } from '@/lib/execution/remote-sandbox/provider'
import type { ResolvedSandbox } from '@/lib/execution/remote-sandbox/resolve'
import { ensureSessionCli } from '@/lib/execution/remote-sandbox/session-cli'
import { initializeSessionFileProvenance } from '@/lib/execution/remote-sandbox/session-file-provenance'
import { withSandboxSessionLock } from '@/lib/execution/remote-sandbox/session-lock'
import type {
  CreateSandboxOptions,
  SandboxKind,
  SandboxProvider,
  SandboxSessionRequest,
} from '@/lib/execution/remote-sandbox/types'

const logger = createLogger('SessionSandbox')

/**
 * How long a session sandbox keeps running after its last use. The provider then pauses it
 * rather than killing it, so a later call resumes the same machine with its files intact.
 */
export const SESSION_SANDBOX_IDLE_MS = 5 * 60_000

/**
 * How long a paused session sandbox is kept before the sweep kills it. With the idle lease, a
 * workbench is discarded about 20 minutes after its last use.
 */
const SESSION_SANDBOX_PAUSED_RETENTION_MS = 15 * 60_000

const REAP_LOCK_TIMEOUT_MS = 10_000
const REAP_CONCURRENCY = 8
/**
 * A sweep starts no kill after this. One kill takes at most the lock wait plus two 5-second
 * provider requests, so the sweep reports within the cron route's 60-second limit; the rest waits
 * for the next run.
 */
const REAP_DEADLINE_MS = 30_000

interface SessionAcquisition {
  created: CreatedSandbox
  status: 'created' | 'reused'
}

/**
 * Called while holding the chat's session lock, for both code and first file writes.
 * A lookup failure must propagate: creating after an outage silently loses the machine.
 * The caller keeps the lock through file I/O, but releases it before running user code.
 */
export async function ensureSessionSandbox(args: {
  provider: SandboxProvider
  kind: SandboxKind
  options: CreateSandboxOptions
  selected: ResolvedSandbox | null
  session: SandboxSessionRequest
  signal: AbortSignal
  bootstrapTimeoutMs: number
}): Promise<SessionAcquisition> {
  const { provider, kind, options, selected, session, signal } = args
  signal.throwIfAborted()
  if (!provider.findSessionSandbox) throw new Error('This deployment has no persistent workbench')
  const lifetimeMs = SESSION_SANDBOX_IDLE_MS + (options.lifetimeMs ?? 0)
  const requestedAtMs = Date.now()
  const existing = await provider.findSessionSandbox(session.key, {
    ...(options.language ? { language: options.language } : {}),
    lifetimeMs,
  })
  signal.throwIfAborted()
  const created: CreatedSandbox = existing
    ? {
        sandbox: existing,
        providerId: provider.id,
        startedAtMs: Date.now(),
        effectiveLifetimeMs: provider.resolveLifetimeMs(lifetimeMs),
        pricing: createSandboxPricing(provider.id, kind),
      }
    : await createSelectedSandbox(
        kind,
        { ...options, lifetimeMs, sessionKey: session.key },
        selected,
        signal,
        true,
        provider
      )
  // Before the abort check: a stopped caller still leaves this machine for the next call to
  // reuse, and a reused machine without history can never be certified.
  if (!existing)
    await initializeSessionFileProvenance(session.key, {
      providerId: provider.id,
      sandboxId: created.sandbox.sandboxId,
    })
  signal.throwIfAborted()
  // Measured from before acquisition: any lease the lookup or create granted starts no earlier.
  if (!created.sandbox.outlives?.(lifetimeMs, requestedAtMs))
    await created.sandbox.extendLifetime?.(lifetimeMs)
  signal.throwIfAborted()
  if (session.cli) {
    await ensureSessionCli(created.sandbox, session.cli, signal, args.bootstrapTimeoutMs)
  }
  signal.throwIfAborted()
  return { created, status: existing ? 'reused' : 'created' }
}

/**
 * Kills session sandboxes paused past {@link SESSION_SANDBOX_PAUSED_RETENTION_MS}. Each kill runs
 * under the session's lock, the same lock every resume takes, and the provider re-checks the
 * sandbox there, so a workbench a caller has just resumed is never killed.
 */
export async function reapPausedSessionSandboxes(): Promise<{
  killed: number
  skipped: number
  deferred: number
  failed: number
}> {
  const provider = resolveProvider()
  const result = { killed: 0, skipped: 0, deferred: 0, failed: 0 }
  if (!provider.listPausedSessionSandboxes || !provider.killPausedSessionSandbox) return result
  const killPaused = provider.killPausedSessionSandbox.bind(provider)

  const deadline = AbortSignal.timeout(REAP_DEADLINE_MS)
  const pausedBeforeMs = Date.now() - SESSION_SANDBOX_PAUSED_RETENTION_MS
  const expired = (await provider.listPausedSessionSandboxes()).filter(
    (sandbox) => sandbox.pausedAtMs <= pausedBeforeMs
  )
  const outcomes = await mapSettledWithConcurrency(expired, REAP_CONCURRENCY, async (sandbox) => {
    if (deadline.aborted) return 'deferred' as const
    const killed = await withSandboxSessionLock(
      sandbox.sessionKey,
      AbortSignal.timeout(REAP_LOCK_TIMEOUT_MS),
      () => killPaused(sandbox, pausedBeforeMs)
    )
    return killed ? ('killed' as const) : ('skipped' as const)
  })
  outcomes.forEach((outcome, index) => {
    if (outcome.status === 'fulfilled') {
      result[outcome.value]++
      return
    }
    result.failed++
    logger.warn('Failed to reap paused session sandbox; the next sweep retries', {
      sandboxId: expired[index].sandboxId,
      error: getErrorMessage(outcome.reason),
    })
  })
  return result
}

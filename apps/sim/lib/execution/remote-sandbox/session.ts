import { createSandboxPricing } from '@/lib/billing/sandbox-pricing'
import { type CreatedSandbox, createSelectedSandbox } from '@/lib/execution/remote-sandbox/create'
import type { ResolvedSandbox } from '@/lib/execution/remote-sandbox/resolve'
import { ensureSessionCli } from '@/lib/execution/remote-sandbox/session-cli'
import type {
  CreateSandboxOptions,
  SandboxKind,
  SandboxProvider,
  SandboxSessionRequest,
} from '@/lib/execution/remote-sandbox/types'

export const SESSION_SANDBOX_IDLE_MS = 20 * 60_000

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
  const existing = await provider.findSessionSandbox(session.key, {
    ...(options.language ? { language: options.language } : {}),
  })
  signal.throwIfAborted()
  const created: CreatedSandbox = existing
    ? {
        sandbox: existing,
        providerId: provider.id,
        startedAtMs: Date.now(),
        effectiveLifetimeMs: provider.resolveLifetimeMs(lifetimeMs),
        pricing: createSandboxPricing(provider.id),
      }
    : await createSelectedSandbox(
        kind,
        { ...options, lifetimeMs, sessionKey: session.key },
        selected,
        signal,
        true,
        provider
      )
  signal.throwIfAborted()
  await created.sandbox.extendLifetime?.(lifetimeMs)
  signal.throwIfAborted()
  if (session.cli) {
    await ensureSessionCli(created.sandbox, session.cli, signal, args.bootstrapTimeoutMs)
  }
  signal.throwIfAborted()
  return { created, status: existing ? 'reused' : 'created' }
}

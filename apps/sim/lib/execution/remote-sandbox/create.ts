import { createLogger } from '@sim/logger'
import { createSandboxPricing, type SandboxPricing } from '@/lib/billing/sandbox-pricing'
import { resolveProvider } from '@/lib/execution/remote-sandbox/provider'
import {
  type ResolvedSandbox,
  repairMissingSandboxImage,
} from '@/lib/execution/remote-sandbox/resolve'
import type {
  CreateSandboxOptions,
  SandboxHandle,
  SandboxKind,
  SandboxProvider,
  SandboxProviderId,
} from '@/lib/execution/remote-sandbox/types'

const logger = createLogger('RemoteSandbox')

export interface CreatedSandbox {
  sandbox: SandboxHandle
  providerId: SandboxProviderId
  startedAtMs: number
  effectiveLifetimeMs?: number
  pricing?: SandboxPricing
}

export async function createSandbox(
  kind: SandboxKind,
  options?: CreateSandboxOptions,
  meterUsage = false,
  provider: SandboxProvider = resolveProvider()
): Promise<CreatedSandbox> {
  const effectiveLifetimeMs =
    options?.lifetimeMs !== undefined ? provider.resolveLifetimeMs(options.lifetimeMs) : undefined
  if (meterUsage && effectiveLifetimeMs === undefined) {
    throw new Error('Metered sandbox execution requires a provider lifetime')
  }
  const pricing = meterUsage ? createSandboxPricing(provider.id) : undefined
  let startedAtMs = Date.now()
  const providerOptions = {
    ...options,
    ...(effectiveLifetimeMs !== undefined ? { lifetimeMs: effectiveLifetimeMs } : {}),
    ...(meterUsage ? { onProviderRequestStarted: (value: number) => (startedAtMs = value) } : {}),
  }
  const sandbox = await provider.create(kind, providerOptions)
  logger.info('Created sandbox', { provider: provider.id, kind, sandboxId: sandbox.sandboxId })
  return {
    sandbox,
    providerId: provider.id,
    startedAtMs,
    ...(effectiveLifetimeMs !== undefined ? { effectiveLifetimeMs } : {}),
    ...(pricing ? { pricing } : {}),
  }
}

/**
 * Creates a sandbox, turning "that image is gone" into a rebuild rather than a
 * failure the author has to resolve by hand.
 *
 * Create is the only step that observes whether the provider image really exists,
 * which is why the repair hangs off it: the registry row and the remote template
 * are two systems with no shared transaction, so keeping them in step is always
 * best-effort, while checking at the point of use is not. Any other failure is
 * rethrown untouched.
 */
export async function createSelectedSandbox(
  kind: SandboxKind,
  options: CreateSandboxOptions,
  selected: ResolvedSandbox | null,
  signal: AbortSignal,
  meterUsage = false,
  provider: SandboxProvider = resolveProvider()
): Promise<CreatedSandbox> {
  try {
    return await createSandbox(kind, options, meterUsage, provider)
  } catch (error) {
    signal.throwIfAborted()
    if (!selected) throw error
    const rebuilding = await repairMissingSandboxImage(selected, error)
    if (!rebuilding) throw error
    throw new Error(rebuilding)
  }
}

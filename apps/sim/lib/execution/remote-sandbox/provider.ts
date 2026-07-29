import { env } from '@/lib/core/config/env'
import { daytonaProvider } from '@/lib/execution/remote-sandbox/daytona'
import { e2bProvider } from '@/lib/execution/remote-sandbox/e2b'
import type { SandboxProvider, SandboxProviderId } from '@/lib/execution/remote-sandbox/types'

/**
 * The known sandbox providers. Keyed by {@link SandboxProviderId}, so adding an
 * adapter is one entry here plus one member on the id union — the type makes an
 * unhandled provider a compile error, not a runtime surprise.
 */
const PROVIDERS: Record<SandboxProviderId, SandboxProvider> = {
  e2b: e2bProvider,
  daytona: daytonaProvider,
}

const DEFAULT_PROVIDER: SandboxProviderId = 'e2b'

/**
 * Resolves which provider serves this execution from the `SANDBOX_PROVIDER` env
 * var (defaulting to {@link DEFAULT_PROVIDER}).
 *
 * Selection is deliberately resolved ONCE, before the sandbox is created, and is
 * never revisited mid-execution: user code has side effects (HTTP calls, S3
 * writes, DB mutations), so retrying a partially-executed run on another provider
 * could duplicate them. Changing providers is a config change — set
 * `SANDBOX_PROVIDER` and redeploy; in-flight executions are unaffected.
 */
export function resolveProvider(): SandboxProvider {
  // Normalize casing identically to env-flags' availability gate — otherwise a
  // value like `Daytona` would pass the gate (which lowercases) but miss this
  // lowercase-keyed map and throw at create time.
  const configured = env.SANDBOX_PROVIDER?.toLowerCase()
  if (!configured) return PROVIDERS[DEFAULT_PROVIDER]
  const provider = PROVIDERS[configured as SandboxProviderId]
  if (!provider) {
    throw new Error(
      `Unknown SANDBOX_PROVIDER "${env.SANDBOX_PROVIDER}" (expected one of: ${Object.keys(PROVIDERS).join(', ')})`
    )
  }
  return provider
}

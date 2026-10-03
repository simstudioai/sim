import { getSelectedSandboxProviderId } from '@/lib/core/config/env-capabilities.server'
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

/**
 * Resolves which provider serves this execution from the `SANDBOX_PROVIDER` env
 * var (defaulting to E2B).
 *
 * Selection is deliberately resolved ONCE, before the sandbox is created, and is
 * never revisited mid-execution: user code has side effects (HTTP calls, S3
 * writes, DB mutations), so retrying a partially-executed run on another provider
 * could duplicate them. Changing providers is a config change — set
 * `SANDBOX_PROVIDER` and redeploy; in-flight executions are unaffected.
 */
export function resolveProvider(): SandboxProvider {
  const configured = getSelectedSandboxProviderId()
  return PROVIDERS[configured]
}

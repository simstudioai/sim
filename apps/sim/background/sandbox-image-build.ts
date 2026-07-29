import { task } from '@trigger.dev/sdk'
import {
  runSandboxImageBuild,
  type SandboxImageBuildPayload,
} from '@/lib/execution/remote-sandbox/image-registry'

/**
 * Trigger.dev wrapper around `runSandboxImageBuild`. The build's lifecycle lives
 * in the `sandbox_image` row rather than the task, so this is a thin shell: the
 * runner claims the row conditionally, which makes a re-delivery a no-op.
 *
 * `maxAttempts: 1` — the runner already polls the provider to a terminal state
 * and records a classified failure the user can act on. A blind retry would just
 * race the row it already marked `failed`; the user retries by saving again.
 */
export const sandboxImageBuildTask = task({
  id: 'sandbox-image-build',
  machine: 'small-1x',
  maxDuration: 1200,
  retry: { maxAttempts: 1 },
  queue: {
    name: 'sandbox-image-build',
    concurrencyLimit: 5,
  },
  run: async (payload: SandboxImageBuildPayload) => {
    await runSandboxImageBuild(payload)
  },
})

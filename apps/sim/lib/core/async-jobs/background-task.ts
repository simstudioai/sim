import type { AnyTask, TaskIdentifier, TaskPayload, TriggerOptions } from '@trigger.dev/sdk'
import { isTriggerDevEnabled } from '@/lib/core/config/env-flags'
import { runDetached } from '@/lib/core/utils/background'

/**
 * Starts one run of a background task: on Trigger.dev, in the region the
 * deployment routes to, when Trigger.dev is enabled; otherwise detached in this
 * process through the runner the task wraps. A caller names its task by type
 * alone (`import type`), and the SDK loads only on the Trigger.dev path, so
 * neither enters the caller's static import graph.
 */
export async function dispatchBackgroundTask<TTask extends AnyTask>(
  id: TaskIdentifier<TTask>,
  payload: TaskPayload<TTask>,
  options: {
    runInProcess: (payload: TaskPayload<TTask>) => Promise<unknown>
    trigger?: Omit<TriggerOptions, 'region'>
  }
): Promise<void> {
  if (!isTriggerDevEnabled) {
    runDetached(id, () => options.runInProcess(payload))
    return
  }
  const [{ tasks }, { resolveTriggerRegion }] = await Promise.all([
    import('@trigger.dev/sdk'),
    import('@/lib/core/async-jobs/region'),
  ])
  await tasks.trigger<TTask>(id, payload, {
    ...options.trigger,
    region: await resolveTriggerRegion(),
  })
}

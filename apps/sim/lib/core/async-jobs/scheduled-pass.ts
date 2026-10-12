import type { TriggerOptions } from '@trigger.dev/sdk'

/**
 * What one cron tick did with a scheduled pass: started none, handed one to Trigger.dev, or
 * started one in this process.
 */
export type ScheduledPassResult =
  | { triggered: false; backend: null; jobId: null }
  | { triggered: true; backend: 'trigger-dev'; jobId: string }
  | { triggered: true; backend: 'inline'; jobId: null }

/** The Trigger.dev run a scheduled pass starts, deduplicated to one per schedule window. */
interface ScheduledPassTrigger {
  taskId: string
  /** The idempotency key is `${keyPrefix}:${window}`; defaults to the task id. */
  keyPrefix?: string
  /** The schedule window's length: every tick inside one window starts the same run. */
  intervalMs: number
  /** The instant whose window keys the run; defaults to the moment the run is triggered. */
  at?: Date
  options?: Pick<TriggerOptions, 'maxDuration' | 'ttl'>
}

interface ScheduledPass {
  /** Whether this tick owes a pass. The call site owns that policy, including a failed check. */
  due: boolean
  /**
   * Whether Trigger.dev runs the pass. Read only once the pass is due, so an availability check
   * with side effects of its own never runs on a tick that starts nothing.
   */
  triggerAvailable: () => boolean
  /** Starts the pass in this process without waiting for it. */
  startInline: () => void
  trigger: ScheduledPassTrigger
}

/**
 * Triggers the window's run and resolves its id once Trigger.dev durably accepts it. Duplicate
 * ticks in one window share the idempotency key, and the key outlives its window so a late
 * duplicate is still folded into the run its window started.
 */
export async function triggerScheduledPass(trigger: ScheduledPassTrigger): Promise<string> {
  const [{ tasks }, { resolveTriggerRegion }] = await Promise.all([
    import('@trigger.dev/sdk'),
    import('@/lib/core/async-jobs/region'),
  ])
  const window = Math.floor((trigger.at?.getTime() ?? Date.now()) / trigger.intervalMs)
  const handle = await tasks.trigger(trigger.taskId, undefined, {
    idempotencyKey: `${trigger.keyPrefix ?? trigger.taskId}:${window}`,
    idempotencyKeyTTL: '5m',
    ...trigger.options,
    region: await resolveTriggerRegion(),
  })
  return handle.id
}

/**
 * Runs one cron tick of a scheduled pass: nothing when no pass is due, the window's Trigger.dev
 * run when Trigger.dev is available, and otherwise a pass started in this process. The result
 * returns once the pass is accepted, never after it finishes.
 */
export async function startScheduledPass(pass: ScheduledPass): Promise<ScheduledPassResult> {
  if (!pass.due) return { triggered: false, backend: null, jobId: null }
  if (!pass.triggerAvailable()) {
    pass.startInline()
    return { triggered: true, backend: 'inline', jobId: null }
  }
  return {
    triggered: true,
    backend: 'trigger-dev',
    jobId: await triggerScheduledPass(pass.trigger),
  }
}

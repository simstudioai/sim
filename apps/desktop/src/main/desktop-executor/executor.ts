/**
 * The background executor's state machine: takes the calls Sim offers this device, runs each in
 * its chat's own browser, terminal or file scope, and delivers every result until Sim
 * acknowledges it, whether or not any window shows that chat.
 *
 * A call is claimed as soon as it is offered, then waits in a local queue per chat and surface,
 * so a busy chat never lets a backlog miss Sim's pickup window. Its lease is renewed from claim
 * until Sim acknowledges the result. Each step is journaled before the step it guards, so a
 * restart reports a call that never started as not started, one that did as outcome unknown, and
 * a finished one with its real result; none is ever run twice.
 */
import type { DesktopToolCompletion } from '@sim/desktop-bridge/tool-results'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { backoffWithJitter } from '@sim/utils/retry'
import {
  type DesktopExecutorClient,
  DeviceRequestError,
  UnsendableRequestError,
} from '@/main/desktop-executor/client'
import type { ExecutorJournal, JournalEntry } from '@/main/desktop-executor/journal'
import type { ClaimedDesktopCall, DesktopInboxItem } from '@/main/desktop-executor/protocol'

const logger = createLogger('DesktopExecutor')

/** Claimed calls this device holds at once, across every chat. */
const DEFAULT_MAX_HELD_CALLS = 32
/** Ceiling on the wait between attempts to deliver one result. */
const DELIVERY_RETRY_MAX_MS = 30_000
/**
 * How long a result that keeps failing to reach Sim holds the machine awake. Delivery keeps
 * retrying after this; it just stops counting as work that needs the machine awake.
 */
const DELIVERY_AWAKE_LIMIT_MS = 10 * 60_000

const NOT_STARTED_AFTER_RESTART =
  'Not run: this action never started, because the Sim desktop app restarted before it began. Nothing happened on the user’s computer. Do not retry it in this turn; tell the user, who can ask again.'
const OUTCOME_UNKNOWN_AFTER_RESTART =
  'The Sim desktop app restarted while this action was running, so its result was lost. It may already have taken effect: inspect the current state before repeating it, and do not retry it automatically.'
const STOPPED_BEFORE_START = 'Stopped before the Sim desktop app started this action.'
const STOPPED_WHILE_RUNNING = 'Stopped while the Sim desktop app was running this action.'
const NOT_RECORDED =
  'Not run: this action never started, because the Sim desktop app could not record it on the user’s computer first. Nothing happened on the user’s computer. Do not retry it in this turn; tell the user, who can ask again later.'
const RESULT_UNSENDABLE =
  'The action finished, but its result could not be encoded to send back. It may have taken effect: inspect the current state before repeating it, and do not retry it automatically.'
const RESULT_TOO_LARGE =
  'The action finished, but its result was too large to send back. Do not repeat a side-effecting action; inspect the current state instead.'

/** Runs one claimed call on this machine. Implementations never throw; failures are completions. */
export interface DesktopToolRunner {
  run(call: ClaimedDesktopCall, signal: AbortSignal): Promise<DesktopToolCompletion>
  /** Stops the action a running call started, through its surface's own cancel. */
  cancel(call: ClaimedDesktopCall): Promise<void>
}

export type DesktopApprovalItem = Extract<DesktopInboxItem, { kind: 'approval_needed' }>

/**
 * Whether a result hands the model what the action produced: not a stop, and not one standing in
 * for an action that did not start, whose outcome is unknown, or whose output was too large to send.
 */
export function isDeliveredResult(completion: DesktopToolCompletion): boolean {
  const data = completion.data
  return (
    completion.status !== 'cancelled' &&
    data?.notStarted !== true &&
    data?.outcomeUnknown !== true &&
    data?.resultOmitted !== true
  )
}

export interface DesktopExecutorOptions {
  client: DesktopExecutorClient
  journal: ExecutorJournal
  runner: DesktopToolRunner
  leaseRenewMs: number
  /** Called when Sim no longer recognizes this device for the current session. */
  onUnregistered: () => void
  /** Every inbox read's calls that wait for the user's approval. */
  onApprovals?: (items: DesktopApprovalItem[]) => void
  /** Called whenever the number of held calls changes between zero and more. */
  onBusyChange?: (busy: boolean) => void
  /**
   * Called once Sim has taken a call's real result ({@link isDeliveredResult}) as the call's own
   * (recorded, or a duplicate of one it recorded): the model has it, so anything it hands back (a
   * pane still running) is in use.
   */
  onResultDelivered?: (toolCallId: string) => void
  /**
   * Called once Sim is done with a call without taking its real result: it settled the call
   * first, refused the result, or recorded one that stands in for it. The model never learns of
   * anything the action handed back as still going, so nothing will come back to it.
   */
  onResultNotDelivered?: (toolCallId: string) => void
  maxHeldCalls?: number
  /** First delivery retry delay; tests shorten it. */
  retryBaseMs?: number
  /** How long a failing delivery keeps the machine awake; tests shorten it. */
  deliveryAwakeLimitMs?: number
}

type HeldPhase = 'queued' | 'running' | 'reporting'

interface HeldCall {
  call: ClaimedDesktopCall
  phase: HeldPhase
  controller: AbortController
  renewTimer: ReturnType<typeof setInterval> | null
  stopped: boolean
}

function surfaceOf(toolName: string): 'browser' | 'terminal' | 'files' {
  if (toolName.startsWith('browser_')) return 'browser'
  if (toolName === 'terminal') return 'terminal'
  return 'files'
}

export class DesktopExecutor {
  private readonly held = new Map<string, HeldCall>()
  /** Each chat surface's tail, so calls in one chat run in the order they were offered. */
  private readonly queues = new Map<string, Promise<void>>()
  private reconciling: Promise<void> | null = null
  private reconcileAgain = false
  private paused = false
  private disposed = false
  private busy = false
  /** The journal walk after a restart; sign-out waits for it before clearing the journal. */
  private recovering: Promise<void> | null = null
  /** Results a previous app run left, still on their way to Sim. */
  private readonly recoveringIds = new Set<string>()
  /**
   * Results a previous app run left, until Sim answers for them, parked ones included: that run's
   * send of the real result may already have landed.
   */
  private readonly recoveredResults = new Set<string>()
  /** Results that have failed to reach Sim for longer than {@link DELIVERY_AWAKE_LIMIT_MS}. */
  private readonly stalledDeliveries = new Set<string>()
  /** Results Sim refused because it no longer recognized this device; sent once it registers again. */
  private readonly parked = new Map<
    string,
    { executionToken: string; completion: DesktopToolCompletion }
  >()

  constructor(private readonly options: DesktopExecutorOptions) {}

  heldCallCount(): number {
    return this.held.size
  }

  /** Suspend stops new claims; held calls keep running and reporting. */
  setPaused(paused: boolean): void {
    this.paused = paused
  }

  /** Reports every call the journal says a previous run of the app left unfinished. */
  async recover(): Promise<void> {
    this.recovering = this.recoverEntries()
    await this.recovering
  }

  private async recoverEntries(): Promise<void> {
    const entries = await this.options.journal.load()
    for (const entry of entries) {
      // Signed out mid-recovery: the previous session's results stay unsent and are cleared.
      if (this.disposed) return
      if (entry.state === 'claiming') {
        // Unknown whether the claim landed. If it did not, the inbox offers the call again. If it
        // did, its token never reached this device, so nothing here can report it; Sim settles it
        // as outcome unknown once its lease lapses, which is conservative because nothing ran.
        await this.forget(entry.toolCallId)
        continue
      }
      const completion: DesktopToolCompletion =
        entry.state === 'result'
          ? entry.completion
          : entry.state === 'claimed'
            ? {
                status: 'error',
                message: NOT_STARTED_AFTER_RESTART,
                data: { error: NOT_STARTED_AFTER_RESTART, notStarted: true },
              }
            : {
                status: 'error',
                message: OUTCOME_UNKNOWN_AFTER_RESTART,
                data: {
                  error: OUTCOME_UNKNOWN_AFTER_RESTART,
                  outcomeUnknown: true,
                  doNotRetry: true,
                },
              }
      logger.info('Reporting a call left unfinished by the previous app run', {
        toolCallId: entry.toolCallId,
        state: entry.state,
      })
      // Held awake like a running call: the result exists only on this machine until Sim has it.
      this.recoveringIds.add(entry.toolCallId)
      this.recoveredResults.add(entry.toolCallId)
      this.updateBusy()
      void this.deliver(entry.toolCallId, entry.executionToken, completion).finally(() => {
        this.recoveringIds.delete(entry.toolCallId)
        this.updateBusy()
      })
    }
  }

  /** After registering again: sends the results parked while Sim did not recognize the device. */
  resumeParked(): void {
    const parked = [...this.parked]
    this.parked.clear()
    for (const [toolCallId, { executionToken, completion }] of parked) {
      void this.deliver(toolCallId, executionToken, completion)
    }
  }

  /**
   * Reads the inbox and acts on it. Concurrent requests coalesce: one more read runs after the
   * current one, so a doorbell that rings mid-read is never lost.
   */
  reconcile(): Promise<void> {
    if (this.reconciling) {
      this.reconcileAgain = true
      return this.reconciling
    }
    const run = async () => {
      try {
        do {
          this.reconcileAgain = false
          await this.reconcileOnce()
        } while (this.reconcileAgain && !this.disposed)
      } catch (error) {
        // Callers fire and forget; one bad read must never become an unhandled rejection.
        logger.error('Desktop inbox read failed unexpectedly', { error: getErrorMessage(error) })
      } finally {
        this.reconciling = null
      }
    }
    this.reconciling = run()
    return this.reconciling
  }

  /** Sign-out: stops every action and forgets every call; the session that owned them is gone. */
  async dispose(): Promise<void> {
    this.disposed = true
    const stopping = this.dropHeld()
    // A claim still in flight sees `disposed` once Sim answers and is never held; the journal is
    // cleared only after it, so its `claiming` record does not outlive the session.
    await this.reconciling?.catch(() => {})
    await Promise.all([stopping, this.dropHeld()])
    await this.recovering?.catch(() => {})
    this.updateBusy()
    await this.options.journal.clear()
  }

  /** Releases every held call and stops the actions already running. */
  private async dropHeld(): Promise<void> {
    const held = [...this.held.values()]
    for (const entry of held) this.release(entry)
    await Promise.allSettled(
      held
        .filter((entry) => entry.phase === 'running')
        .map((entry) => {
          entry.controller.abort()
          return this.options.runner.cancel(entry.call)
        })
    )
  }

  private async reconcileOnce(): Promise<void> {
    if (this.disposed) return
    let items: DesktopInboxItem[]
    try {
      items = await this.options.client.listInbox()
    } catch (error) {
      this.noteRequestFailure('Could not read the desktop inbox', error)
      return
    }
    // Signed out while the read was in flight: its approvals and calls belong to the old account.
    if (this.disposed) return
    for (const item of items) {
      if (item.kind === 'cancel') void this.stop(item.toolCallId, 'Stopped by the user.')
    }
    try {
      this.options.onApprovals?.(
        items.filter((item): item is DesktopApprovalItem => item.kind === 'approval_needed')
      )
    } catch (error) {
      // Notifications are a courtesy; the calls in this read still get claimed.
      logger.warn('Could not notify about desktop approvals', { error: getErrorMessage(error) })
    }
    for (const item of items) {
      if (item.kind !== 'call' || this.held.has(item.toolCallId)) continue
      if (this.paused || this.disposed) return
      if (this.held.size >= (this.options.maxHeldCalls ?? DEFAULT_MAX_HELD_CALLS)) return
      await this.claim(item.toolCallId)
    }
  }

  /** Writes a journal transition; false when it could not be made durable. */
  private async record(entry: JournalEntry): Promise<boolean> {
    try {
      await this.options.journal.put(entry)
      return true
    } catch (error) {
      logger.warn('Could not record a desktop call locally', {
        toolCallId: entry.toolCallId,
        state: entry.state,
        error: getErrorMessage(error),
      })
      return false
    }
  }

  private async forget(toolCallId: string): Promise<void> {
    await this.options.journal.remove(toolCallId).catch((error) =>
      logger.warn('Could not forget a desktop call locally', {
        toolCallId,
        error: getErrorMessage(error),
      })
    )
  }

  private async claim(toolCallId: string): Promise<void> {
    // Unrecorded, a claim that then crashed could never be accounted for; leave it on offer.
    if (!(await this.record({ toolCallId, state: 'claiming' }))) return
    let call: ClaimedDesktopCall
    try {
      call = await this.options.client.claim(toolCallId)
    } catch (error) {
      await this.forget(toolCallId)
      this.noteRequestFailure('Desktop call was not claimed', error, { toolCallId })
      return
    }
    if (this.disposed) return
    // Best effort: an unrecorded token leaves `claiming`, which recovery treats conservatively.
    await this.record({ toolCallId, state: 'claimed', executionToken: call.executionToken })
    const entry: HeldCall = {
      call,
      phase: 'queued',
      controller: new AbortController(),
      renewTimer: null,
      stopped: false,
    }
    this.held.set(toolCallId, entry)
    this.updateBusy()
    entry.renewTimer = setInterval(() => void this.renew(entry), this.options.leaseRenewMs)
    logger.info('Claimed a desktop call', {
      toolCallId,
      toolName: call.toolName,
      chatId: call.chatId,
    })
    this.enqueue(entry)
  }

  private enqueue(entry: HeldCall): void {
    const key = `${entry.call.chatId}:${surfaceOf(entry.call.toolName)}`
    const tail = this.queues.get(key) ?? Promise.resolve()
    const next = tail.then(() => this.execute(entry))
    this.queues.set(key, next)
    void next.finally(() => {
      if (this.queues.get(key) === next) this.queues.delete(key)
    })
  }

  private async execute(entry: HeldCall): Promise<void> {
    if (entry.stopped || this.disposed) return
    const { call } = entry
    const recorded = await this.record({
      toolCallId: call.toolCallId,
      state: 'started',
      executionToken: call.executionToken,
    })
    if (entry.stopped || this.disposed) return
    entry.phase = 'reporting'
    if (!recorded) {
      // Running it unrecorded could let a crash report an action that ran as never started.
      await this.deliver(call.toolCallId, call.executionToken, {
        status: 'error',
        message: NOT_RECORDED,
        data: { error: NOT_RECORDED, notStarted: true },
      })
      this.release(entry)
      return
    }
    entry.phase = 'running'
    const completion = await this.options.runner.run(call, entry.controller.signal)
    if (this.disposed || this.held.get(call.toolCallId) !== entry) return
    entry.phase = 'reporting'
    // A stopped call's result is only an acknowledgement: Sim already settled it, so nothing the
    // action produced (page text, file contents) leaves the machine.
    await this.deliver(
      call.toolCallId,
      call.executionToken,
      entry.stopped ? { status: 'cancelled', message: STOPPED_WHILE_RUNNING } : completion
    )
    this.release(entry)
  }

  /**
   * Delivers a result until Sim acknowledges it. Any answer Sim gives for the token acknowledges
   * it: recorded, a duplicate of one already recorded, or superseded by Sim settling it first.
   */
  private async deliver(
    toolCallId: string,
    executionToken: string,
    completion: DesktopToolCompletion
  ): Promise<void> {
    if (this.disposed) return
    // Best effort: unrecorded, a crash reports the call from its `started` entry as outcome unknown.
    await this.record({ toolCallId, state: 'result', executionToken, completion })
    const sendingSince = Date.now()
    try {
      await this.sendResult(toolCallId, executionToken, completion, sendingSince)
    } finally {
      // Whoever holds the delivery (a held call, a recovered result) updates the busy state as it
      // lets go; doing it here first would flash the machine awake again in between.
      this.stalledDeliveries.delete(toolCallId)
    }
  }

  private async sendResult(
    toolCallId: string,
    executionToken: string,
    completion: DesktopToolCompletion,
    sendingSince: number
  ): Promise<void> {
    let pending = completion
    let notDelivered = true
    for (let attempt = 1; !this.disposed; attempt++) {
      try {
        const outcome = await this.options.client.complete({
          toolCallId,
          executionToken,
          completion: pending,
        })
        logger.info('Desktop call result acknowledged', { toolCallId, outcome })
        // Superseded: Sim settled the call first, so this result never reached the model.
        const delivered = outcome !== 'superseded' && isDeliveredResult(pending)
        if (delivered) this.options.onResultDelivered?.(toolCallId)
        // A duplicate holds what this app run sent, unless the result was recovered unchanged from
        // an earlier run, whose send of the real result may have landed before the restart.
        const takenEarlier =
          outcome === 'duplicate' && pending === completion && this.recoveredResults.has(toolCallId)
        notDelivered = !delivered && !takenEarlier
        break
      } catch (error) {
        // Encoding failed on this machine, so nothing was sent; the same data would fail again.
        if (error instanceof UnsendableRequestError && pending.data !== undefined) {
          pending = {
            status: 'error',
            message: RESULT_UNSENDABLE,
            data: { error: RESULT_UNSENDABLE, outcomeUnknown: true, doNotRetry: true },
          }
          continue
        }
        if (!(error instanceof DeviceRequestError)) {
          logger.error('Could not send a desktop call result; dropping it', {
            toolCallId,
            error: getErrorMessage(error),
          })
          break
        }
        if (error.unregistered) {
          // Retrying cannot help until the device registers again; the journal keeps the result.
          this.parked.set(toolCallId, { executionToken, completion: pending })
          this.options.onUnregistered()
          return
        }
        if (error.status === 413 && pending.data !== undefined) {
          pending = {
            status: pending.status,
            message: RESULT_TOO_LARGE,
            data: { error: RESULT_TOO_LARGE, resultOmitted: true },
          }
          continue
        }
        if (!error.transient) {
          logger.warn('Sim refused a desktop call result; dropping it', {
            toolCallId,
            status: error.status,
          })
          break
        }
        if (
          Date.now() - sendingSince >
            (this.options.deliveryAwakeLimitMs ?? DELIVERY_AWAKE_LIMIT_MS) &&
          !this.stalledDeliveries.has(toolCallId)
        ) {
          // Still retried, but no longer a reason to keep the machine awake.
          this.stalledDeliveries.add(toolCallId)
          this.updateBusy()
        }
        await sleep(
          backoffWithJitter(attempt, error.retryAfterMs, {
            baseMs: this.options.retryBaseMs,
            maxMs: DELIVERY_RETRY_MAX_MS,
          })
        )
      }
    }
    this.recoveredResults.delete(toolCallId)
    if (this.disposed) return
    if (notDelivered) this.options.onResultNotDelivered?.(toolCallId)
    await this.forget(toolCallId)
  }

  private async renew(entry: HeldCall): Promise<void> {
    if (this.held.get(entry.call.toolCallId) !== entry) return
    try {
      await this.options.client.renewLease(entry.call.toolCallId, entry.call.executionToken)
    } catch (error) {
      if (error instanceof DeviceRequestError && error.status === 410) {
        this.clearRenewal(entry)
        await this.stop(entry.call.toolCallId, 'Sim no longer holds this call for this device.')
        return
      }
      this.noteRequestFailure('Could not renew a desktop call lease', error, {
        toolCallId: entry.call.toolCallId,
      })
    }
  }

  /**
   * Stops a held call Sim settled without it. A queued call never starts; a running one is
   * interrupted. Either way its result is still delivered, which acknowledges the stop.
   */
  private async stop(toolCallId: string, reason: string): Promise<void> {
    const entry = this.held.get(toolCallId)
    if (!entry || entry.stopped) return
    entry.stopped = true
    logger.info('Stopping a desktop call', { toolCallId, phase: entry.phase, reason })
    if (entry.phase === 'queued') {
      entry.phase = 'reporting'
      await this.deliver(toolCallId, entry.call.executionToken, {
        status: 'cancelled',
        message: STOPPED_BEFORE_START,
        data: { error: STOPPED_BEFORE_START, notStarted: true },
      })
      this.release(entry)
      return
    }
    if (entry.phase === 'running') {
      entry.controller.abort()
      await this.options.runner.cancel(entry.call).catch((error) =>
        logger.warn('Could not stop a desktop action', {
          toolCallId,
          error: getErrorMessage(error),
        })
      )
    }
  }

  private release(entry: HeldCall): void {
    this.clearRenewal(entry)
    if (this.held.get(entry.call.toolCallId) === entry) this.held.delete(entry.call.toolCallId)
    this.updateBusy()
  }

  private clearRenewal(entry: HeldCall): void {
    if (entry.renewTimer) clearInterval(entry.renewTimer)
    entry.renewTimer = null
  }

  private updateBusy(): void {
    // A disposed executor reports idle once, at dispose; a delivery that settles later must not
    // speak for the executor that replaced it.
    const awake = (toolCallId: string) => !this.stalledDeliveries.has(toolCallId)
    const busy =
      !this.disposed && ([...this.held.keys()].some(awake) || [...this.recoveringIds].some(awake))
    if (busy === this.busy) return
    this.busy = busy
    this.options.onBusyChange?.(busy)
  }

  private noteRequestFailure(
    message: string,
    error: unknown,
    context: Record<string, unknown> = {}
  ): void {
    if (error instanceof DeviceRequestError && error.unregistered) {
      this.options.onUnregistered()
    }
    logger.warn(message, {
      ...context,
      ...(error instanceof DeviceRequestError ? { status: error.status } : {}),
      error: getErrorMessage(error),
    })
  }
}

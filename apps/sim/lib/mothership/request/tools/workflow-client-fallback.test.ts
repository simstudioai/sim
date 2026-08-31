/**
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { waitForWorkflowToolCompletion, claimWorkflowToolExecution, recordDegraded } = vi.hoisted(
  () => ({
    waitForWorkflowToolCompletion: vi.fn(),
    claimWorkflowToolExecution: vi.fn(),
    recordDegraded: vi.fn(),
  })
)

vi.mock('@/lib/mothership/request/metrics', () => ({ recordDegraded }))

vi.mock('@/lib/mothership/request/tools/client', () => ({
  waitForWorkflowToolCompletion,
}))

vi.mock('@/lib/mothership/async-runs/repository', () => ({
  claimWorkflowToolExecution,
}))

import { raceWorkflowToolClientPickup } from '@/lib/mothership/request/tools/workflow-client-fallback'

const GRACE_MS = 30_000
const TIMEOUT_MS = 3_600_000

/** Captures the abort signal the waiter was handed so tests can assert teardown. */
let waiterSignals: (AbortSignal | undefined)[] = []

/** Models the real waiter: pends until aborted, then resolves null. */
function pendingUntilAborted() {
  waitForWorkflowToolCompletion.mockImplementation(({ abortSignal }) => {
    waiterSignals.push(abortSignal)
    return new Promise((resolve) => {
      if (abortSignal?.aborted) {
        resolve(null)
        return
      }
      abortSignal?.addEventListener('abort', () => resolve(null), { once: true })
    })
  })
}

function baseParams(overrides: Record<string, unknown> = {}) {
  return {
    toolCallId: 'tool-1',
    workflowId: 'workflow-1',
    timeoutMs: TIMEOUT_MS,
    graceMs: GRACE_MS,
    runOnServer: vi.fn().mockResolvedValue({ status: 'success' }),
    ...overrides,
  }
}

describe('raceWorkflowToolClientPickup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    waiterSignals = []
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('lets the client win without ever attempting a claim', async () => {
    waitForWorkflowToolCompletion.mockResolvedValue({ status: 'success', data: { ok: true } })
    const params = baseParams()

    const outcome = await raceWorkflowToolClientPickup(params as never)

    expect(outcome.winner).toBe('client')
    expect(outcome.completion).toEqual({ status: 'success', data: { ok: true } })
    expect(claimWorkflowToolExecution).not.toHaveBeenCalled()
    expect(params.runOnServer).not.toHaveBeenCalled()
  })

  it('runs the tool server-side when the grace elapses and the claim is won', async () => {
    pendingUntilAborted()
    claimWorkflowToolExecution.mockResolvedValue({ toolCallId: 'tool-1' })
    const params = baseParams()

    const promise = raceWorkflowToolClientPickup(params as never)
    await vi.advanceTimersByTimeAsync(GRACE_MS)
    const outcome = await promise

    expect(outcome.winner).toBe('sim')
    expect(outcome.signal).toEqual({ status: 'success' })
    // Falling back is non-fatal, so it has to be countable — Sim logs do not
    // reach Loki and this path emits no exported span.
    expect(recordDegraded).toHaveBeenCalledWith('client_pickup_timeout')
    expect(claimWorkflowToolExecution).toHaveBeenCalledTimes(1)
    expect(params.runOnServer).toHaveBeenCalledTimes(1)
    // The claimed id is what the server run must bind to.
    expect(params.runOnServer).toHaveBeenCalledWith(outcome.boundExecutionId)
    expect(outcome.boundExecutionId).toBeTruthy()
    // The client waiter must be torn down before the server runs, or the sim
    // path's own confirmation would wake it and emit a duplicate result.
    expect(waiterSignals.at(0)?.aborted).toBe(true)
  })

  it('claims immediately when the caller declared no client pickup (graceMs 0)', async () => {
    // ChatRequest.clientCapabilities without 'workflow-tool-pickup' resolves to graceMs 0
    // at the dispatch site: same claim arbitration, no dead-air grace for a client that
    // the caller itself said will never come.
    pendingUntilAborted()
    claimWorkflowToolExecution.mockResolvedValue({ toolCallId: 'tool-1' })
    const params = baseParams({ graceMs: 0 })

    const promise = raceWorkflowToolClientPickup(params as never)
    await vi.advanceTimersByTimeAsync(0)
    const outcome = await promise

    expect(outcome.winner).toBe('sim')
    expect(claimWorkflowToolExecution).toHaveBeenCalledTimes(1)
    expect(params.runOnServer).toHaveBeenCalledTimes(1)
    expect(waiterSignals.at(0)?.aborted).toBe(true)
  })

  it('keeps waiting on the browser when the claim is lost', async () => {
    // The waiter stays pending until the "browser" reports, so we can assert the
    // helper went back to waiting on the same promise rather than running.
    let reportFromBrowser!: (value: unknown) => void
    waitForWorkflowToolCompletion.mockImplementation(({ abortSignal }) => {
      waiterSignals.push(abortSignal)
      return new Promise((resolve) => {
        reportFromBrowser = resolve
      })
    })
    claimWorkflowToolExecution.mockResolvedValue(null)
    const params = baseParams()

    const promise = raceWorkflowToolClientPickup(params as never)
    await vi.advanceTimersByTimeAsync(GRACE_MS)

    expect(claimWorkflowToolExecution).toHaveBeenCalledTimes(1)
    expect(params.runOnServer).not.toHaveBeenCalled()
    // The waiter must NOT have been torn down — a browser owns this call.
    expect(waiterSignals.at(0)?.aborted).toBe(false)

    reportFromBrowser({ status: 'success', data: { ranInBrowser: true } })
    const outcome = await promise

    expect(outcome.winner).toBe('client')
    expect(outcome.completion).toEqual({ status: 'success', data: { ranInBrowser: true } })
    expect(waitForWorkflowToolCompletion).toHaveBeenCalledTimes(1)
  })

  it('never claims work on a turn the user already stopped', async () => {
    pendingUntilAborted()
    const abortController = new AbortController()
    const params = baseParams({ abortSignal: abortController.signal })

    const promise = raceWorkflowToolClientPickup(params as never)
    abortController.abort()
    await vi.advanceTimersByTimeAsync(GRACE_MS)
    const outcome = await promise

    expect(outcome.winner).toBe('client')
    expect(claimWorkflowToolExecution).not.toHaveBeenCalled()
    expect(params.runOnServer).not.toHaveBeenCalled()
  })

  it('still falls back when the wait expires before the grace window', async () => {
    // A caller-supplied timeout shorter than the grace makes the waiter resolve
    // null first; that is an expired wait, not a missing completion.
    waitForWorkflowToolCompletion.mockResolvedValue(null)
    claimWorkflowToolExecution.mockResolvedValue({ toolCallId: 'tool-1' })
    const params = baseParams({ timeoutMs: 1_000 })

    const promise = raceWorkflowToolClientPickup(params as never)
    await vi.advanceTimersByTimeAsync(1_000)
    const outcome = await promise

    expect(outcome.winner).toBe('sim')
    expect(params.runOnServer).toHaveBeenCalledTimes(1)
  })

  it('keeps waiting on the browser when the claim itself errors', async () => {
    waitForWorkflowToolCompletion.mockResolvedValue(null)
    claimWorkflowToolExecution.mockRejectedValue(new Error('db down'))
    const params = baseParams({ timeoutMs: 1_000 })

    const promise = raceWorkflowToolClientPickup(params as never)
    await vi.advanceTimersByTimeAsync(1_000)
    const outcome = await promise

    // Losing the claim to an error must never become a second execution.
    expect(outcome.winner).toBe('client')
    expect(params.runOnServer).not.toHaveBeenCalled()
  })
})

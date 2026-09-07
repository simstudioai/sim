/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  prepareSandboxSessionAccess,
  recordSandboxProcess,
  reportUnsettledSandboxProcess,
  settleSandboxProcess,
} from '@/lib/execution/remote-sandbox/execution-observer'

const { claim, settle, recordProcess, settleProcess, prepareAccess, recover, renew, complete } =
  vi.hoisted(() => ({
    claim: vi.fn(),
    renew: vi.fn(),
    complete: vi.fn(),
    settle: vi.fn(),
    recordProcess: vi.fn(),
    settleProcess: vi.fn(),
    prepareAccess: vi.fn(),
    recover: vi.fn(),
  }))
vi.mock('@/lib/mothership/async-runs/repository', () => ({
  claimSimToolExecution: claim,
  renewSimToolExecutionLease: renew,
  completeOwnedSimToolCall: complete,
  completeAsyncToolCall: complete,
  settleSimToolExecution: settle,
  recordSimSandboxProcess: recordProcess,
  settleSimSandboxProcess: settleProcess,
  prepareWorkbenchAccess: prepareAccess,
}))
vi.mock('@/lib/mothership/request/tools/sandbox-recovery', () => ({
  recoverSandboxProcesses: recover,
}))

import { withToolExecutionLifetime } from '@/lib/mothership/request/tools/execution-lifetime'

function pending() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('durable tool execution lifetime', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    claim.mockResolvedValue({ outcome: 'claimed' })
    renew.mockResolvedValue(true)
    complete.mockResolvedValue(undefined)
    settle.mockResolvedValue(undefined)
    recordProcess.mockResolvedValue(undefined)
    settleProcess.mockResolvedValue(undefined)
    prepareAccess.mockResolvedValue({ handlersPending: false, processes: [] })
    recover.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('records command identity before execution and leaves tracked uncertainty in its durable entry', async () => {
    const process = { id: 'process-1', sandboxId: 'sandbox-1', sessionKey: 'chat-1' }
    await withToolExecutionLifetime('tool-1', async (lifetime) => {
      await lifetime.claim('run-1', 'user-1')
      await recordSandboxProcess(process)
      reportUnsettledSandboxProcess(process.id)
    })
    expect(recordProcess).toHaveBeenCalledExactlyOnceWith({
      toolCallId: 'tool-1',
      runId: 'run-1',
      userId: 'user-1',
      ownerToken: expect.any(String),
      process,
    })
    expect(settleProcess).not.toHaveBeenCalled()
    expect(settle).toHaveBeenCalledExactlyOnceWith('tool-1', expect.any(String))
  })

  it('recovers prior commands and rechecks durable state before allowing session access', async () => {
    const processes = [
      { id: 'prior', sandboxId: 'retained', sessionKey: 'chat-1', toolCallId: 'old-tool' },
    ]
    prepareAccess.mockResolvedValueOnce({ handlersPending: false, processes })
    await withToolExecutionLifetime('tool-1', async (lifetime) => {
      await lifetime.claim('run-1', 'user-1')
      await prepareSandboxSessionAccess('chat-1', AbortSignal.timeout(1000))
    })
    expect(recover).toHaveBeenCalledExactlyOnceWith(processes, expect.any(AbortSignal))
    expect(prepareAccess).toHaveBeenCalledTimes(2)
    expect(prepareAccess).toHaveBeenCalledWith({
      runId: 'run-1',
      userId: 'user-1',
      ownerToken: expect.any(String),
      toolCallId: 'tool-1',
      sessionKey: 'chat-1',
    })
  })

  it.each(['handler', 'command'])(
    'does not grant reuse while a prior %s remains unresolved',
    async (kind) => {
      prepareAccess.mockResolvedValue({
        handlersPending: kind === 'handler',
        processes:
          kind === 'command'
            ? [{ id: 'prior', sandboxId: 'retained', sessionKey: 'chat-1', toolCallId: 'old-tool' }]
            : [],
      })
      await expect(
        withToolExecutionLifetime('tool-1', async (lifetime) => {
          await lifetime.claim('run-1', 'user-1')
          await prepareSandboxSessionAccess('chat-1', AbortSignal.timeout(1000))
        })
      ).rejects.toThrow('Earlier tool work has not finished')
    }
  )

  it('does not touch a workbench without a claimed tool identity', async () => {
    await expect(
      withToolExecutionLifetime('tool-1', async () => {
        await prepareSandboxSessionAccess('chat-1', AbortSignal.timeout(1000))
      })
    ).rejects.toThrow('requires an admitted')
    expect(prepareAccess).not.toHaveBeenCalled()
  })

  it('fails closed without returning database details when ownership verification fails', async () => {
    prepareAccess.mockRejectedValueOnce(new Error('SELECT private_database_detail'))
    await expect(
      withToolExecutionLifetime('tool-1', async (lifetime) => {
        await lifetime.claim('run-1', 'user-1')
        await prepareSandboxSessionAccess('chat-1', AbortSignal.timeout(1000))
      })
    ).rejects.toThrow('Workbench access could not be verified for this tool execution')
    expect(recover).not.toHaveBeenCalled()
  })

  it('does not continue admission if Stop arrives during recovery', async () => {
    const controller = new AbortController()
    prepareAccess.mockResolvedValueOnce({
      handlersPending: false,
      processes: [{ id: 'prior', sandboxId: 'retained', sessionKey: 'chat-1', toolCallId: 'old' }],
    })
    recover.mockImplementationOnce(async () => controller.abort(new Error('User Stop')))
    await expect(
      withToolExecutionLifetime('tool-1', async (lifetime) => {
        await lifetime.claim('run-1', 'user-1')
        await prepareSandboxSessionAccess('chat-1', controller.signal)
      })
    ).rejects.toThrow('User Stop')
    expect(prepareAccess).toHaveBeenCalledTimes(1)
  })

  it('preserves a performed result when the command settlement write fails', async () => {
    settleProcess.mockRejectedValueOnce(new Error('database unavailable'))
    const result = await withToolExecutionLifetime('tool-1', async (lifetime) => {
      await lifetime.claim('run-1', 'user-1')
      await recordSandboxProcess({ id: 'process-1', sandboxId: 'sandbox-1', sessionKey: 'chat-1' })
      await settleSandboxProcess('process-1')
      return 'performed'
    })
    expect(result).toBe('performed')
    expect(settle).toHaveBeenCalledExactlyOnceWith('tool-1', expect.any(String))
  })

  it('keeps ownership after the displayed timeout while the handler still runs', async () => {
    const work = pending()
    const result = await withToolExecutionLifetime('timed-out', async (lifetime) => {
      await lifetime.claim('run-1', 'user-1')
      lifetime.hold(work.promise)
      return 'timeout'
    })
    expect(result).toBe('timeout')
    expect(settle).not.toHaveBeenCalled()
    work.resolve()
    await work.promise
    expect(settle).toHaveBeenCalledExactlyOnceWith('timed-out', expect.any(String))
  })

  it('also waits for result post-processing after the handler ends', async () => {
    const processing = pending()
    const entered = pending()
    const result = withToolExecutionLifetime('processing', async (lifetime) => {
      await lifetime.claim('run-1', 'user-1')
      await lifetime.hold(Promise.resolve())
      entered.resolve()
      await processing.promise
      return 'success'
    })
    await entered.promise
    expect(settle).not.toHaveBeenCalled()
    processing.resolve()
    expect(await result).toBe('success')
    expect(settle).toHaveBeenCalledExactlyOnceWith('processing', expect.any(String))
  })

  it('retains remote uncertainty only for the affected concurrent invocation', async () => {
    const uncertain = withToolExecutionLifetime('uncertain', async (lifetime) => {
      await lifetime.claim('run-1', 'user-1')
      await lifetime.hold(Promise.resolve().then(() => reportUnsettledSandboxProcess()))
      return 'cancelled'
    })
    const sibling = withToolExecutionLifetime('sibling', async (lifetime) => {
      await lifetime.claim('run-1', 'user-1')
      await lifetime.hold(Promise.resolve())
    })
    await Promise.all([uncertain, sibling])
    expect(settle).toHaveBeenCalledExactlyOnceWith('sibling', expect.any(String))
  })

  it('does not release another owner on duplicate admission', async () => {
    claim.mockResolvedValueOnce({ outcome: 'closed' })
    await withToolExecutionLifetime('closed', async (lifetime) => {
      expect(await lifetime.claim('run-1', 'user-1')).toEqual({ outcome: 'closed' })
    })
    expect(settle).not.toHaveBeenCalled()
  })

  it('preserves a completed mutation result when its settlement write fails', async () => {
    settle.mockRejectedValueOnce(new Error('database unavailable'))
    expect(
      await withToolExecutionLifetime('performed', async (lifetime) => {
        await lifetime.claim('run-1', 'user-1')
        return { created: true }
      })
    ).toEqual({ created: true })
    expect(settle).toHaveBeenCalledExactlyOnceWith('performed', expect.any(String))
  })

  it('renews a retained handler after its visible timeout and stops renewing after settlement', async () => {
    vi.useFakeTimers()
    const work = pending()
    await withToolExecutionLifetime('retained', async (lifetime) => {
      await lifetime.claim('run-1', 'user-1')
      lifetime.hold(work.promise)
    })
    await vi.advanceTimersByTimeAsync(80_000)
    expect(renew).toHaveBeenCalledTimes(4)
    expect(settle).not.toHaveBeenCalled()
    work.resolve()
    await work.promise
    await vi.advanceTimersByTimeAsync(80_000)
    expect(renew).toHaveBeenCalledTimes(4)
    expect(settle).toHaveBeenCalledOnce()
  })

  it.each(['expired', 'database unavailable'])(
    'aborts a handler and rejects new commands after %s',
    async (reason) => {
      vi.useFakeTimers()
      if (reason === 'expired') renew.mockResolvedValueOnce(false)
      else renew.mockRejectedValueOnce(new Error(reason))
      await withToolExecutionLifetime('expired', async (lifetime) => {
        await lifetime.claim('run-1', 'user-1')
        await vi.advanceTimersByTimeAsync(20_000)
        expect(lifetime.signal.aborted).toBe(true)
        await expect(
          recordSandboxProcess({ id: 'late', sandboxId: 'sandbox', sessionKey: 'chat' })
        ).rejects.toThrow('lost its owner')
        await expect(
          prepareSandboxSessionAccess('chat', new AbortController().signal)
        ).rejects.toThrow('lost its owner')
        expect(recordProcess).not.toHaveBeenCalled()
        expect(prepareAccess).not.toHaveBeenCalled()
      })
      expect(settle).toHaveBeenCalledOnce()
    }
  )

  it('uses the execution token for its terminal result and propagates a refused write', async () => {
    complete.mockRejectedValueOnce(new Error('lease lost'))
    const receipt = { toolCallId: 'owned', status: 'completed' as const, result: { created: true } }
    await expect(
      withToolExecutionLifetime('owned', async (lifetime) => {
        await lifetime.claim('run-1', 'user-1')
        await lifetime.complete(receipt)
      })
    ).rejects.toThrow('lease lost')
    expect(complete).toHaveBeenCalledWith(receipt, claim.mock.calls[0][0].ownerToken)
  })
})

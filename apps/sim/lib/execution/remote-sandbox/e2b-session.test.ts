/** @vitest-environment node */

import { sleep } from '@sim/utils/helpers'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  create,
  list,
  connect,
  nextItems,
  getInfo,
  setTimeout,
  runCommand,
  stopCommand,
  killSandbox,
  connectCommand,
  sessionLock,
  lockState,
  NotFoundError,
} = vi.hoisted(() => ({
  create: vi.fn(),
  list: vi.fn(),
  connect: vi.fn(),
  nextItems: vi.fn(),
  getInfo: vi.fn(),
  setTimeout: vi.fn(),
  runCommand: vi.fn(),
  stopCommand: vi.fn(),
  killSandbox: vi.fn(),
  connectCommand: vi.fn(),
  sessionLock: vi.fn(),
  lockState: { active: false },
  NotFoundError: class NotFoundError extends Error {},
}))
vi.mock('@/lib/core/config/env', () => ({
  env: { E2B_API_KEY: 'test', MOTHERSHIP_E2B_TEMPLATE_ID: 'mothership-template' },
}))
vi.mock('@e2b/code-interpreter', () => ({
  Sandbox: { create, list, connect, getInfo },
  NotFoundError,
}))
vi.mock('@/lib/execution/remote-sandbox/session-lock', () => ({
  withSandboxSessionLock: sessionLock,
}))

import { e2bProvider, stopE2BSessionProcess } from '@/lib/execution/remote-sandbox/e2b'
import { observeSandboxExecution } from '@/lib/execution/remote-sandbox/execution-observer'

function candidate(sandboxId: string, time: number) {
  return {
    sandboxId,
    startedAt: new Date(time),
    endAt: new Date(Date.now() + 3_600_000),
    metadata: { simSessionKey: 'chat', simSessionOwnership: 'tracked-v1' },
  }
}

function sessionSandbox(source: 'created' | 'reconnected') {
  if (source === 'created') return e2bProvider.create('mothership', { sessionKey: 'chat' })
  list.mockReturnValue({ nextItems, hasNext: false })
  nextItems.mockResolvedValue([candidate('retained', 10)])
  return e2bProvider.findSessionSandbox?.('chat', {})
}

describe('E2B session recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    lockState.active = false
    sessionLock.mockImplementation(
      async (
        _key: string,
        signal: AbortSignal,
        action: (signal: AbortSignal) => Promise<unknown>
      ) => {
        signal.throwIfAborted()
        lockState.active = true
        try {
          return await action(signal)
        } finally {
          lockState.active = false
        }
      }
    )
    const sandbox = {
      sandboxId: 'retained',
      getInfo,
      setTimeout,
      commands: {
        run: (command: string, options: { background?: boolean }) =>
          options.background === false
            ? stopCommand(command, options)
            : runCommand(command, options),
        kill: vi.fn(),
        connect: connectCommand,
      },
      kill: killSandbox,
    }
    connect.mockResolvedValue(sandbox)
    create.mockResolvedValue(sandbox)
    stopCommand.mockResolvedValue({ stdout: '{"settled": true}', stderr: '', exitCode: 0 })
  })

  it('records command ownership before dispatch and joins the matching kernel receipt', async () => {
    const sandbox = await sessionSandbox('created')
    if (!sandbox) throw new Error('Missing sandbox')
    let recordedId = ''
    const claimProcess = vi.fn(async (process) => {
      expect(runCommand).not.toHaveBeenCalled()
      expect(process).toMatchObject({ sandboxId: 'retained', sessionKey: 'chat' })
      recordedId = process.id
    })
    const settleProcess = vi.fn(async (id: string) => {
      expect(id).toBe(recordedId)
      expect(stopCommand).toHaveBeenCalledOnce()
    })
    runCommand.mockImplementationOnce(async (command: string) => {
      expect(command).toContain(`run ${recordedId} `)
      return { pid: 1, wait: async () => ({ stdout: 'done', stderr: '', exitCode: 0 }) }
    })
    await observeSandboxExecution(
      { hold: vi.fn(), unsettled: vi.fn(), claimProcess, settleProcess },
      () => sandbox.runCommand('work', { timeoutMs: 1000 })
    )
    expect(claimProcess).toHaveBeenCalledOnce()
    expect(settleProcess).toHaveBeenCalledOnce()
    expect(stopCommand.mock.calls[0]?.[0]).toContain(`stop ${recordedId}`)
  })

  it('preserves an untracked existing machine without silently replacing or reusing it', async () => {
    list.mockReturnValue({ nextItems, hasNext: false })
    nextItems.mockResolvedValue([
      { ...candidate('untracked', 1), metadata: { simSessionKey: 'chat' } },
    ])
    await expect(e2bProvider.findSessionSandbox?.('chat', {})).rejects.toThrow(
      'requires recovery before reuse'
    )
    expect(connect).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
    expect(killSandbox).not.toHaveBeenCalled()
  })

  it('refuses dispatch when command ownership cannot be persisted', async () => {
    const sandbox = await sessionSandbox('created')
    if (!sandbox) throw new Error('Missing sandbox')
    await observeSandboxExecution(
      {
        hold: vi.fn(),
        unsettled: vi.fn(),
        claimProcess: async () => {
          throw new Error('ownership unavailable')
        },
      },
      () => sandbox.runCommand('work', { timeoutMs: 1000 })
    )
    expect(runCommand).not.toHaveBeenCalled()
    expect(stopCommand).not.toHaveBeenCalled()
  })

  it('closes a recorded command if Stop arrives while its database receipt is being written', async () => {
    const sandbox = await sessionSandbox('created')
    if (!sandbox) throw new Error('Missing sandbox')
    const controller = new AbortController()
    const settleProcess = vi.fn()
    await observeSandboxExecution(
      {
        hold: vi.fn(),
        unsettled: vi.fn(),
        settleProcess,
        claimProcess: async () => {
          controller.abort(new Error('User Stop'))
        },
      },
      () => sandbox.runCommand('work', { timeoutMs: 1000, signal: controller.signal })
    )
    expect(runCommand).not.toHaveBeenCalled()
    expect(stopCommand).toHaveBeenCalledOnce()
    expect(settleProcess).toHaveBeenCalledOnce()
  })

  const process = {
    id: '00000000-0000-4000-8000-000000000001',
    sandboxId: 'retained',
    sessionKey: 'chat',
  }

  it('recovers the exact sandbox and releases its allocation lock before stopping the command', async () => {
    getInfo.mockResolvedValueOnce({
      metadata: { simSessionKey: 'chat' },
      endAt: new Date(Date.now() + 3_600_000),
    })
    stopCommand.mockImplementationOnce(async () => {
      expect(lockState.active).toBe(false)
      return { stdout: '{"settled":true}', exitCode: 0 }
    })
    const signal = new AbortController().signal
    await stopE2BSessionProcess(process, signal)
    expect(getInfo).toHaveBeenCalledWith('retained', expect.objectContaining({ signal }))
    expect(connect).toHaveBeenCalledWith('retained', expect.objectContaining({ signal }))
    expect(connect.mock.calls[0]?.[1].timeoutMs).toBeGreaterThan(3_590_000)
    expect(list).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
    expect(killSandbox).not.toHaveBeenCalled()
  })

  it.each(['lookup', 'connect'] as const)(
    'accepts sandbox expiry during %s, while other provider failures remain unresolved',
    async (stage) => {
      getInfo.mockResolvedValue({ metadata: { simSessionKey: 'chat' }, endAt: new Date() })
      const operation = stage === 'lookup' ? getInfo : connect
      operation.mockRejectedValueOnce(new NotFoundError('gone'))
      await stopE2BSessionProcess(process, new AbortController().signal)
      expect(stopCommand).not.toHaveBeenCalled()
      operation.mockRejectedValueOnce(new Error('outage'))
      await expect(stopE2BSessionProcess(process, new AbortController().signal)).rejects.toThrow(
        'outage'
      )
    }
  )

  it('refuses recovery of a sandbox belonging to another session', async () => {
    getInfo.mockResolvedValueOnce({ metadata: { simSessionKey: 'other' }, endAt: new Date() })
    await expect(stopE2BSessionProcess(process, new AbortController().signal)).rejects.toThrow(
      'scope'
    )
    expect(connect).not.toHaveBeenCalled()
    expect(stopCommand).not.toHaveBeenCalled()
  })

  it('propagates the recovery budget through lookup and refuses further dispatch after it expires', async () => {
    const controller = new AbortController()
    getInfo.mockImplementationOnce(async (_id, options) => {
      expect(options.signal).toBe(controller.signal)
      controller.abort(new Error('recovery budget expired'))
      return { metadata: { simSessionKey: 'chat' }, endAt: new Date() }
    })
    await expect(stopE2BSessionProcess(process, controller.signal)).rejects.toThrow(
      'budget expired'
    )
    expect(connect).not.toHaveBeenCalled()
    expect(stopCommand).not.toHaveBeenCalled()
  })

  it('searches paused workbenches and all pages before choosing the canonical session', async () => {
    let pages = 2
    list.mockReturnValue({
      nextItems,
      get hasNext() {
        return pages > 0
      },
    })
    nextItems.mockImplementation(async () =>
      --pages ? [candidate('newer', 20)] : [candidate('retained', 10)]
    )
    const sandbox = await e2bProvider.findSessionSandbox?.('chat', {})
    expect(list.mock.calls[0]?.[0].query.state).toEqual(['running', 'paused'])
    expect(nextItems).toHaveBeenCalledTimes(2)
    expect(connect).toHaveBeenCalledWith('retained', expect.anything())
    expect(connect.mock.calls[0]?.[1].timeoutMs).toBeGreaterThan(3_590_000)
    expect(sandbox?.sandboxId).toBe('retained')
  })

  it('distinguishes absence from lookup and reconnect outages', async () => {
    list.mockReturnValue({ nextItems, hasNext: false })
    nextItems.mockResolvedValueOnce([])
    expect(await e2bProvider.findSessionSandbox?.('chat', {})).toBeNull()
    nextItems.mockRejectedValueOnce(new Error('listing unavailable'))
    await expect(e2bProvider.findSessionSandbox?.('chat', {})).rejects.toThrow(
      'listing unavailable'
    )
    nextItems.mockResolvedValue([candidate('retained', 10)])
    connect.mockRejectedValueOnce(new Error('resume unavailable'))
    await expect(e2bProvider.findSessionSandbox?.('chat', {})).rejects.toThrow('resume unavailable')
  })

  it.each(['created', 'reconnected'] as const)(
    'a %s session preserves parallel deadlines',
    async (source) => {
      const sandbox = await sessionSandbox(source)
      getInfo.mockResolvedValueOnce({ endAt: new Date(Date.now() + 3_600_000) })
      await sandbox?.extendLifetime?.(60_000)
      expect(setTimeout).not.toHaveBeenCalled()
      getInfo.mockResolvedValueOnce({ endAt: new Date(Date.now() + 1000) })
      await sandbox?.extendLifetime?.(60_000)
      expect(setTimeout).toHaveBeenCalledWith(60_000)
    }
  )
  it.each(['created', 'reconnected'] as const)('Stop preserves a %s workbench', async (source) => {
    const sandbox = await sessionSandbox(source)
    if (!sandbox) throw new Error('Missing sandbox')
    let entered!: () => void
    let cancel!: (error: Error) => void
    const waiting = new Promise<void>((resolve) => {
      entered = resolve
    })
    runCommand.mockResolvedValue({
      pid: 101,
      wait: () => {
        entered()
        return new Promise((_resolve, reject) => {
          cancel = reject
        })
      },
    })
    stopCommand.mockImplementation(async () => {
      cancel(new Error('process cancelled'))
      return { stdout: '{"settled": true}', stderr: '', exitCode: 0 }
    })
    const controller = new AbortController()
    const result = sandbox.runCommand('long job', { timeoutMs: 60_000, signal: controller.signal })
    await waiting
    controller.abort()
    await result
    expect(stopCommand).toHaveBeenCalledOnce()
    expect(killSandbox).not.toHaveBeenCalled()
  })

  it.each(['created', 'reconnected'] as const)(
    'output overflow preserves a %s workbench',
    async (source) => {
      const sandbox = await sessionSandbox(source)
      if (!sandbox) throw new Error('Missing sandbox')
      runCommand.mockImplementation(async (_command, options) => ({
        pid: 102,
        wait: async () => {
          options.onStdout('x'.repeat(32))
          return { stdout: '', stderr: '', exitCode: 0 }
        },
      }))
      await expect(
        sandbox.runCommand('too loud', { timeoutMs: 60_000, maxOutputBytes: 8 })
      ).rejects.toThrow()
      expect(stopCommand).toHaveBeenCalledOnce()
      expect(killSandbox).not.toHaveBeenCalled()
    }
  )

  it('does not launch a session command after Stop', async () => {
    const sandbox = await sessionSandbox('created')
    if (!sandbox) throw new Error('Missing sandbox')
    await expect(
      sandbox.runCommand('late job', {
        timeoutMs: 60_000,
        signal: AbortSignal.abort(new Error('User Stop')),
      })
    ).rejects.toThrow('User Stop')
    expect(runCommand).not.toHaveBeenCalled()
  })

  it.each(['launch', 'kill'] as const)(
    'reports %s uncertainty to the owning tool independently of its error response',
    async (stage) => {
      const sandbox = await sessionSandbox('created')
      if (!sandbox) throw new Error('Missing sandbox')
      const controller = new AbortController()
      if (stage === 'launch') {
        runCommand.mockRejectedValueOnce(new Error('launch acknowledgement lost'))
        stopCommand.mockRejectedValueOnce(new Error('control unavailable'))
      } else {
        runCommand.mockResolvedValueOnce({
          pid: 109,
          wait: async () => {
            controller.abort(new Error('User Stop'))
            throw controller.signal.reason
          },
        })
        stopCommand.mockRejectedValueOnce(new Error('kill unavailable'))
      }
      const unsettled = vi.fn()
      await expect(
        observeSandboxExecution({ hold: vi.fn(), unsettled }, () =>
          sandbox.runCommand('write once', {
            timeoutMs: 60_000,
            atMostOnce: true,
            signal: controller.signal,
          })
        )
      ).rejects.toThrow()
      expect(unsettled).toHaveBeenCalledOnce()
    }
  )

  it('keeps ownership through a delayed kill acknowledgement', async () => {
    const sandbox = await sessionSandbox('created')
    if (!sandbox) throw new Error('Missing sandbox')
    const controller = new AbortController()
    let entered!: () => void
    const waiting = new Promise<void>((resolve) => {
      entered = resolve
    })
    let stopped!: () => void
    stopCommand.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          stopped = () => resolve({ stdout: '{"settled": true}', stderr: '', exitCode: 0 })
        })
    )
    runCommand.mockResolvedValueOnce({
      pid: 104,
      wait: () =>
        new Promise((_resolve, reject) => {
          controller.signal.addEventListener('abort', () => reject(controller.signal.reason), {
            once: true,
          })
          entered()
        }),
    })
    let settled = false
    const execution = sandbox
      .runCommand('long job', { timeoutMs: 60_000, signal: controller.signal })
      .finally(() => {
        settled = true
      })
    await waiting
    controller.abort(new Error('User Stop'))
    try {
      await sleep(1)
      expect(stopCommand).toHaveBeenCalledOnce()
      expect(settled).toBe(false)
    } finally {
      stopped()
      await execution
    }
    expect(settled).toBe(true)
    expect(killSandbox).not.toHaveBeenCalled()
  })

  it('does not mistake the named process exit for a namespace receipt', async () => {
    const sandbox = await sessionSandbox('created')
    if (!sandbox) throw new Error('Missing sandbox')
    const controller = new AbortController()
    runCommand.mockResolvedValueOnce({
      pid: 110,
      wait: async () => {
        controller.abort(new Error('User Stop'))
        await sleep(1)
        return { stdout: '', stderr: '', exitCode: 0 }
      },
    })
    stopCommand.mockRejectedValueOnce(new Error('kill unavailable'))
    const unsettled = vi.fn()
    await expect(
      observeSandboxExecution({ hold: vi.fn(), unsettled }, () =>
        sandbox.runCommand('finishing job', { timeoutMs: 60_000, signal: controller.signal })
      )
    ).rejects.toThrow('kill unavailable')

    expect(stopCommand).toHaveBeenCalledOnce()
    expect(unsettled).toHaveBeenCalledOnce()
    expect(killSandbox).not.toHaveBeenCalled()
  })

  it('surfaces a failed process kill instead of acknowledging cancellation', async () => {
    const sandbox = await sessionSandbox('created')
    if (!sandbox) throw new Error('Missing sandbox')
    const controller = new AbortController()
    runCommand.mockResolvedValueOnce({
      pid: 105,
      wait: async () => {
        controller.abort(new Error('User Stop'))
        throw controller.signal.reason
      },
    })
    stopCommand.mockRejectedValueOnce(new Error('kill unavailable'))
    await expect(
      sandbox.runCommand('long job', { timeoutMs: 60_000, signal: controller.signal })
    ).rejects.toThrow('kill unavailable')
    expect(killSandbox).not.toHaveBeenCalled()
  })

  it('accepts a kernel receipt proving the command namespace is settled', async () => {
    const sandbox = await sessionSandbox('created')
    if (!sandbox) throw new Error('Missing sandbox')
    const controller = new AbortController()
    runCommand.mockResolvedValueOnce({
      pid: 108,
      wait: async () => {
        controller.abort(new Error('User Stop'))
        throw controller.signal.reason
      },
    })
    stopCommand.mockResolvedValueOnce({ stdout: '{"settled": true}', stderr: '', exitCode: 0 })
    const result = await sandbox.runCommand('finished job', {
      timeoutMs: 60_000,
      signal: controller.signal,
    })
    expect(result).toMatchObject({ exitCode: 1, stderr: 'User Stop' })
    expect(stopCommand).toHaveBeenCalledOnce()
    expect(killSandbox).not.toHaveBeenCalled()
  })

  it('reconnects an at-most-once session command to its known PID without relaunching', async () => {
    const sandbox = await sessionSandbox('created')
    if (!sandbox) throw new Error('Missing sandbox')
    runCommand.mockResolvedValueOnce({
      pid: 106,
      wait: async () => {
        throw new Error('stream disconnected')
      },
    })
    connectCommand.mockResolvedValueOnce({
      pid: 106,
      wait: async () => ({ stdout: 'done', stderr: '', exitCode: 0 }),
    })
    const result = await sandbox.runCommand('write once', { timeoutMs: 60_000, atMostOnce: true })
    expect(result).toMatchObject({ stdout: 'done', exitCode: 0 })
    expect(runCommand).toHaveBeenCalledOnce()
    expect(connectCommand).toHaveBeenCalledWith(106, expect.anything())
    expect(stopCommand).toHaveBeenCalledOnce()
  })

  it('stops its known process when result recovery fails', async () => {
    const sandbox = await sessionSandbox('created')
    if (!sandbox) throw new Error('Missing sandbox')
    runCommand.mockResolvedValueOnce({
      pid: 107,
      wait: async () => {
        throw new Error('stream disconnected')
      },
    })
    connectCommand.mockRejectedValueOnce(new Error('reconnect unavailable'))
    await sandbox.runCommand('long job', { timeoutMs: 60_000 })
    expect(stopCommand).toHaveBeenCalledOnce()
    expect(killSandbox).not.toHaveBeenCalled()
  })
})

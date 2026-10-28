/**
 * @vitest-environment jsdom
 */
import { Blob as NodeBlob } from 'node:buffer'
import { sleep } from '@sim/utils/helpers'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { executeTerminalTool, reportClientToolCompletion } = vi.hoisted(() => ({
  executeTerminalTool: vi.fn(),
  reportClientToolCompletion: vi.fn(),
}))

vi.mock('@/lib/terminal/transport', () => ({ executeTerminalTool }))
vi.mock('@/lib/mothership/tools/client/completion', () => ({ reportClientToolCompletion }))

import { executeTerminalToolOnClient } from '@/lib/mothership/tools/client/terminal-tool-execution'

describe('terminal client execution', () => {
  beforeEach(() => {
    vi.stubGlobal('Blob', NodeBlob)
    window.sessionStorage.clear()
    Object.defineProperty(navigator, 'sendBeacon', {
      configurable: true,
      value: vi.fn(() => true),
    })
    reportClientToolCompletion.mockResolvedValue(undefined)
  })

  it('marks a page-exit result as indeterminate and unsafe to retry', async () => {
    let resolveExecution: (result: unknown) => void = () => {}
    executeTerminalTool.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveExecution = resolve
        })
    )

    executeTerminalToolOnClient('terminal-page-exit', { operation: 'read', args: {} }, 'chat-1')
    window.dispatchEvent(new Event('pagehide'))

    const beacon = vi.mocked(navigator.sendBeacon)
    expect(beacon).toHaveBeenCalledOnce()
    const payload = beacon.mock.calls[0]?.[1]
    expect(JSON.parse(await (payload as NodeBlob).text())).toMatchObject({
      toolCallId: 'terminal-page-exit',
      status: 'error',
      data: { outcomeUnknown: true, doNotRetry: true },
    })

    resolveExecution({ output: 'done' })
    await sleep(0)
    window.dispatchEvent(new Event('pagehide'))
    expect(beacon).toHaveBeenCalledOnce()
  })

  it('reports a call delivered too late as never started instead of dropping it', async () => {
    const emittedAt = new Date(Date.now() - 5 * 60_000).toISOString()

    executeTerminalToolOnClient(
      'terminal-stale',
      { operation: 'run', args: { command: 'bun run test' } },
      'chat-1',
      emittedAt
    )
    await sleep(0)

    expect(reportClientToolCompletion).toHaveBeenCalledWith(
      'terminal-stale',
      'error',
      expect.stringContaining('never started'),
      expect.objectContaining({ notStarted: true })
    )
  })

  it('tells the model the code of a generic terminal failure', async () => {
    const reported: Array<{ status: string; data: unknown }> = []
    reportClientToolCompletion.mockImplementation(
      async (_id: string, status: string, _message: string, data: unknown) => {
        reported.push({ status, data })
      }
    )
    executeTerminalTool.mockRejectedValue(new Error('The terminal went away'))

    executeTerminalToolOnClient('terminal-generic', { operation: 'read', args: {} }, 'chat-1')

    await vi.waitFor(() => expect(reported).toHaveLength(1))
    expect(reported[0]).toEqual({
      status: 'error',
      data: { error: 'The terminal went away', code: 'Error' },
    })
  })
})

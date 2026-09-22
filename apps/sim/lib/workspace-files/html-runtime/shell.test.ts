import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'
import { htmlRuntimeShell } from '@/lib/workspace-files/html-runtime/shell'

interface WorkflowBridge {
  run(workflowId: string, input?: Record<string, unknown>): Promise<unknown>
  subscribe(workflowId: string, callback: (result: unknown) => void): () => void
}

describe('HTML workflow bridge', () => {
  it('publishes the synchronous run response to subscribers without a status poll', async () => {
    const dom = new JSDOM(htmlRuntimeShell('https://sim.ai'), {
      runScripts: 'dangerously',
      url: 'https://file.simstudio.ai/html-frame',
    })
    try {
      const port = {
        onmessage: null as ((event: { data: unknown }) => void) | null,
        postMessage: vi.fn(),
        start: vi.fn(),
      }
      dom.window.dispatchEvent(
        new dom.window.MessageEvent('message', {
          data: { type: 'sim:html:init', html: '<html><body></body></html>' },
          origin: 'https://sim.ai',
          source: dom.window as unknown as MessageEventSource,
          ports: [port as unknown as MessagePort],
        })
      )
      const bridge = (dom.window as unknown as { sim: { workflows: WorkflowBridge } }).sim.workflows
      const subscriber = vi.fn()
      bridge.subscribe('wf_1', subscriber)

      const run = bridge.run('wf_1')
      expect(port.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'sim:workflow:request', method: 'run', workflowId: 'wf_1' })
      )
      const [{ requestId }] = port.postMessage.mock.calls[0] as [{ requestId: number }]
      const result = { status: 'completed', output: { ok: true } }
      port.onmessage?.({ data: { type: 'sim:workflow:response', requestId, result } })

      await expect(run).resolves.toEqual(result)
      expect(subscriber).toHaveBeenCalledExactlyOnceWith(result)

      const inputRun = bridge.run('wf_1', { incidentId: '123' })
      const [{ requestId: inputRequestId }] = port.postMessage.mock.calls[1] as [
        { requestId: number },
      ]
      port.onmessage?.({
        data: { type: 'sim:workflow:response', requestId: inputRequestId, result },
      })
      await expect(inputRun).resolves.toEqual(result)
      expect(subscriber).toHaveBeenCalledTimes(1)
    } finally {
      dom.window.close()
    }
  })
})

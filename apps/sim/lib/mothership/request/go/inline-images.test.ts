import { beforeEach, describe, expect, it, vi } from 'vitest'

const materialize = vi.hoisted(() => vi.fn())
vi.mock('@/lib/mothership/chat/application/inline-images', () => ({
  materializeStreamImage: materialize,
}))

import { createStreamingContext } from '@/lib/mothership/request/context/request-context'
import type { ExecutionContext, StreamEvent } from '@/lib/mothership/request/types'
import { prepareStreamImages } from './inline-images'

const chatId = '0518a4c3-f530-4520-8713-9bb3535ef605'
const requestId = 'dbd59c19-ea27-43da-992d-71601358e667'
const execution: ExecutionContext = {
  userId: 'image-test-user',
  workspaceId: '2821d1ac-a3be-4fa4-ac8a-6b3db1de039a',
  workflowId: '',
  chatId,
  copilotToolExecution: true,
}
function text(value: string): StreamEvent {
  return { type: 'text', payload: { channel: 'assistant', text: value } }
}

describe('stream image publication', () => {
  beforeEach(() => materialize.mockReset().mockResolvedValue({ url: '/private-image' }))

  it('waits for complete Markdown and keeps the receipt text untouched', async () => {
    const context = createStreamingContext({ chatId, requestId })
    const attempted = new Set<string>()
    const prefix = 'Controls: ![Diagram](/tmp/page.png'
    await prepareStreamImages(text(prefix), context, execution, attempted)
    expect(materialize).not.toHaveBeenCalled()
    context.accumulatedContent = prefix
    const closing = text(')\n')
    await prepareStreamImages(closing, context, execution, attempted)
    expect(materialize).toHaveBeenCalledWith(
      {
        userId: execution.userId,
        workspaceId: execution.workspaceId,
        chatId,
      },
      { requestId, reference: '/tmp/page.png', signal: undefined }
    )
    expect(closing).toEqual(text(')\n'))
    expect(context.accumulatedContent).toBe(prefix)
  })

  it('does not publish code examples, ordinary links, external images or subagent output', async () => {
    const context = createStreamingContext({ chatId, requestId })
    const attempted = new Set<string>()
    await prepareStreamImages(
      text('`![Example](/tmp/a.png)` [Link](/tmp/a.png) ![Remote](https://example.com/a.png)'),
      context,
      execution,
      attempted
    )
    await prepareStreamImages(
      { ...text('![Child](/tmp/a.png)'), scope: { lane: 'subagent', parentToolCallId: 'child' } },
      context,
      execution,
      attempted
    )
    expect(materialize).not.toHaveBeenCalled()
  })

  it('uses the final receipt to resolve reference images and deduplicates repeated references', async () => {
    const context = createStreamingContext({
      chatId,
      requestId,
      accumulatedContent: '![One][image] ![Two][image]\n\n[image]: uploads/photo.png',
    })
    const attempted = new Set<string>()
    const complete: StreamEvent = { type: 'complete', payload: { status: 'complete' } }
    await prepareStreamImages(complete, context, execution, attempted)
    await prepareStreamImages(complete, context, execution, attempted)
    expect(materialize).toHaveBeenCalledTimes(1)
    expect(materialize.mock.calls[0][1].reference).toBe('uploads/photo.png')
  })

  it('bounds publication and does not turn a missing image into a failed answer', async () => {
    materialize.mockRejectedValueOnce(new Error('Missing file'))
    const context = createStreamingContext({ chatId, requestId })
    const content = Array.from({ length: 25 }, (_, i) => `![${i}](/tmp/${i}.png)`).join('\n')
    await expect(
      prepareStreamImages(text(content), context, execution, new Set())
    ).resolves.toBeUndefined()
    expect(materialize).toHaveBeenCalledTimes(20)
    expect(context.errors).toEqual([])
  })

  it('requires a trusted scoped lifecycle and propagates cancellation', async () => {
    const context = createStreamingContext({ chatId, requestId })
    await prepareStreamImages(
      text('![x](/tmp/a.png)'),
      context,
      { ...execution, copilotToolExecution: false },
      new Set()
    )
    expect(materialize).not.toHaveBeenCalled()
    const controller = new AbortController()
    controller.abort(new Error('Stopped'))
    await expect(
      prepareStreamImages(
        text('![x](/tmp/a.png)'),
        context,
        execution,
        new Set(),
        controller.signal
      )
    ).rejects.toThrow('Stopped')
  })
})

/**
 * @vitest-environment node
 */

import type { ChatCompletionChunk } from 'openai/resources/chat/completions'
import type { CompletionUsage } from 'openai/resources/completions'
import { describe, expect, it, vi } from 'vitest'
import { createReadableStreamFromXAIStream } from '@/providers/xai/utils'

async function drainStream(stream: ReadableStream<unknown>): Promise<void> {
  const reader = stream.getReader()
  while (!(await reader.read()).done) {}
}

describe('createReadableStreamFromXAIStream', () => {
  it('forwards detailed usage and the effective service tier', async () => {
    const usage: CompletionUsage = {
      prompt_tokens: 32,
      completion_tokens: 9,
      total_tokens: 135,
      prompt_tokens_details: { cached_tokens: 6 },
      completion_tokens_details: { reasoning_tokens: 94 },
    }
    const terminalChunk = {
      id: 'chatcmpl-xai',
      choices: [],
      created: 0,
      model: 'grok-4.5',
      object: 'chat.completion.chunk',
      usage,
      service_tier: 'priority',
    } as unknown as ChatCompletionChunk
    const onComplete = vi.fn()

    const stream = createReadableStreamFromXAIStream(
      (async function* () {
        yield terminalChunk
      })(),
      onComplete
    )

    await drainStream(stream)

    expect(onComplete).toHaveBeenCalledWith('', usage, '', 'priority')
  })

  it("does not forward service tiers outside xAI's documented values", async () => {
    const usage: CompletionUsage = {
      prompt_tokens: 1,
      completion_tokens: 1,
      total_tokens: 2,
    }
    const terminalChunk = {
      id: 'chatcmpl-xai',
      choices: [],
      created: 0,
      model: 'grok-4.5',
      object: 'chat.completion.chunk',
      usage,
      service_tier: 'flex',
    } as ChatCompletionChunk
    const onComplete = vi.fn()

    const stream = createReadableStreamFromXAIStream(
      (async function* () {
        yield terminalChunk
      })(),
      onComplete
    )

    await drainStream(stream)

    expect(onComplete).toHaveBeenCalledWith('', usage, '', undefined)
  })
})

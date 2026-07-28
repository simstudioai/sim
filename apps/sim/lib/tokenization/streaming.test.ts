import { describe, expect, it } from 'vitest'
import { processStreamingBlockLog } from '@/lib/tokenization/streaming'

describe('processStreamingBlockLog', () => {
  it('does not estimate usage from sanitized environment references', () => {
    const log = {
      blockId: 'agent-1',
      blockType: 'agent',
      input: {
        prompt: 'Use {{OPENAI_API_KEY}} to answer',
        model: 'gpt-4o',
      },
      output: {
        content: 'streamed answer',
        model: 'gpt-4o',
      },
    }

    expect(processStreamingBlockLog(log, 'streamed answer')).toBe(false)
    expect(log.output).toEqual({
      content: 'streamed answer',
      model: 'gpt-4o',
    })
  })
})

/**
 * @vitest-environment node
 *
 * Fixture gate: Anthropic stream fixtures parse and match expected assembled
 * thinking/text/tool/signature content. No provider adapters are exercised yet.
 */
import { describe, expect, it } from 'vitest'
import {
  anthropicRedactedThinkingAssembledContent,
  anthropicRedactedThinkingExpectedText,
  anthropicRedactedThinkingExpectedTraceThinking,
  anthropicRedactedThinkingStreamEvents,
  anthropicThinkingTextToolAssembledContent,
  anthropicThinkingTextToolExpectedText,
  anthropicThinkingTextToolExpectedThinking,
  anthropicThinkingTextToolStreamEvents,
} from '@/providers/__fixtures__/anthropic'

type StreamEvent = {
  type: string
  index?: number
  delta?: {
    type: string
    thinking?: string
    text?: string
    signature?: string
    partial_json?: string
  }
  content_block?: {
    type: string
    thinking?: string
    text?: string
    data?: string
    id?: string
    name?: string
    input?: unknown
    signature?: string
  }
}

function assembleAnthropicContentFromStream(events: readonly StreamEvent[]) {
  const blocks: Array<Record<string, unknown>> = []

  for (const event of events) {
    if (event.type === 'content_block_start' && event.content_block) {
      const block = event.content_block
      if (block.type === 'thinking') {
        blocks.push({ type: 'thinking', thinking: block.thinking ?? '', signature: '' })
      } else if (block.type === 'redacted_thinking') {
        blocks.push({ type: 'redacted_thinking', data: block.data ?? '' })
      } else if (block.type === 'text') {
        blocks.push({ type: 'text', text: block.text ?? '' })
      } else if (block.type === 'tool_use') {
        blocks.push({
          type: 'tool_use',
          id: block.id,
          name: block.name,
          inputJson: '',
        })
      }
      continue
    }

    if (event.type !== 'content_block_delta' || event.index === undefined || !event.delta) {
      continue
    }

    const target = blocks[event.index]
    if (!target) continue

    const delta = event.delta
    if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
      target.thinking = `${target.thinking ?? ''}${delta.thinking}`
    } else if (delta.type === 'signature_delta' && typeof delta.signature === 'string') {
      target.signature = delta.signature
    } else if (delta.type === 'text_delta' && typeof delta.text === 'string') {
      target.text = `${target.text ?? ''}${delta.text}`
    } else if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
      target.inputJson = `${target.inputJson ?? ''}${delta.partial_json}`
    }
  }

  return blocks.map((block) => {
    if (block.type === 'tool_use') {
      const inputJson = typeof block.inputJson === 'string' ? block.inputJson : '{}'
      return {
        type: 'tool_use',
        id: block.id,
        name: block.name,
        input: JSON.parse(inputJson || '{}'),
      }
    }
    if (block.type === 'thinking') {
      return {
        type: 'thinking',
        thinking: block.thinking,
        signature: block.signature,
      }
    }
    return block
  })
}

function extractTextDeltas(events: readonly StreamEvent[]): string {
  return events
    .filter(
      (e) =>
        e.type === 'content_block_delta' &&
        e.delta?.type === 'text_delta' &&
        typeof e.delta.text === 'string'
    )
    .map((e) => e.delta!.text!)
    .join('')
}

function extractThinkingDeltas(events: readonly StreamEvent[]): string {
  return events
    .filter(
      (e) =>
        e.type === 'content_block_delta' &&
        e.delta?.type === 'thinking_delta' &&
        typeof e.delta.thinking === 'string'
    )
    .map((e) => e.delta!.thinking!)
    .join('')
}

function assertValidStreamSequence(events: readonly StreamEvent[]) {
  expect(events[0]?.type).toBe('message_start')
  expect(events[events.length - 1]?.type).toBe('message_stop')

  const open = new Set<number>()
  for (const event of events) {
    if (event.type === 'content_block_start' && event.index !== undefined) {
      expect(open.has(event.index)).toBe(false)
      open.add(event.index)
    }
    if (event.type === 'content_block_stop' && event.index !== undefined) {
      expect(open.has(event.index)).toBe(true)
      open.delete(event.index)
    }
  }
  expect(open.size).toBe(0)
}

describe('Anthropic stream fixtures', () => {
  it('parses thinking → text → tool_use stream and preserves signature', () => {
    assertValidStreamSequence(anthropicThinkingTextToolStreamEvents)

    expect(extractThinkingDeltas(anthropicThinkingTextToolStreamEvents)).toBe(
      anthropicThinkingTextToolExpectedThinking
    )
    expect(extractTextDeltas(anthropicThinkingTextToolStreamEvents)).toBe(
      anthropicThinkingTextToolExpectedText
    )

    const assembled = assembleAnthropicContentFromStream(anthropicThinkingTextToolStreamEvents)
    expect(assembled).toEqual([...anthropicThinkingTextToolAssembledContent])

    const thinkingBlock = assembled.find((b) => b.type === 'thinking') as {
      signature?: string
    }
    expect(thinkingBlock?.signature).toMatch(/^EpAB/)
  })

  it('parses redacted_thinking + signed thinking + text and matches trace mapping', () => {
    assertValidStreamSequence(anthropicRedactedThinkingStreamEvents)

    expect(extractTextDeltas(anthropicRedactedThinkingStreamEvents)).toBe(
      anthropicRedactedThinkingExpectedText
    )

    const assembled = assembleAnthropicContentFromStream(anthropicRedactedThinkingStreamEvents)
    expect(assembled).toEqual([...anthropicRedactedThinkingAssembledContent])

    // Mirrors enrichLastModelSegmentFromAnthropicResponse: redacted → "[redacted]"
    const traceThinking = assembled
      .filter((b) => b.type === 'thinking' || b.type === 'redacted_thinking')
      .map((b) => (b.type === 'thinking' ? b.thinking : '[redacted]'))
      .join('\n\n')
    expect(traceThinking).toBe(anthropicRedactedThinkingExpectedTraceThinking)
  })

  it('documents that live stream today would only surface text_delta bytes', () => {
    // Baseline behavior of createReadableStreamFromAnthropicStream: only text_delta
    // is enqueued. This test locks the fixture expectation for later adapter work.
    const textOnlyFromStream = extractTextDeltas(anthropicThinkingTextToolStreamEvents)
    const thinkingFromStream = extractThinkingDeltas(anthropicThinkingTextToolStreamEvents)

    expect(textOnlyFromStream).toBe(anthropicThinkingTextToolExpectedText)
    expect(thinkingFromStream.length).toBeGreaterThan(0)
    expect(textOnlyFromStream).not.toContain('I should check the weather')
  })
})

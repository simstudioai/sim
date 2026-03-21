import type { ClientContentBlock, ClientStreamingContext } from '@/lib/copilot/client-sse/types'

/**
 * Appends plain text to the active text block, or starts a new one when needed.
 */
export function appendTextBlock(context: ClientStreamingContext, content: string): void {
  if (!content) return

  context.accumulatedContent += content

  if (context.currentTextBlock?.type === 'text') {
    context.currentTextBlock.content = `${context.currentTextBlock.content || ''}${content}`
    return
  }

  const block: ClientContentBlock = {
    type: 'text',
    content,
    timestamp: Date.now(),
  }

  context.currentTextBlock = block
  context.contentBlocks.push(block)
}

/**
 * Starts a new thinking block when the stream enters a reasoning segment.
 */
export function beginThinkingBlock(context: ClientStreamingContext): void {
  if (context.currentThinkingBlock) {
    context.isInThinkingBlock = true
    context.currentTextBlock = null
    return
  }

  const block: ClientContentBlock = {
    type: 'thinking',
    content: '',
    timestamp: Date.now(),
    startTime: Date.now(),
  }

  context.currentThinkingBlock = block
  context.contentBlocks.push(block)
  context.currentTextBlock = null
  context.isInThinkingBlock = true
}

/**
 * Closes the active thinking block and records its visible duration.
 */
export function finalizeThinkingBlock(context: ClientStreamingContext): void {
  if (!context.currentThinkingBlock) {
    context.isInThinkingBlock = false
    return
  }

  const startTime = context.currentThinkingBlock.startTime ?? context.currentThinkingBlock.timestamp
  context.currentThinkingBlock.duration = Math.max(0, Date.now() - startTime)
  context.currentThinkingBlock = null
  context.isInThinkingBlock = false
}

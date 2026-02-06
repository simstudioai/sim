import type {
  ChatContext,
  CopilotMessage,
  MessageFileAttachment,
} from '@/stores/panel/copilot/types'
import type { ClientContentBlock, ClientStreamingContext } from './types'

const TEXT_BLOCK_TYPE = 'text'
const THINKING_BLOCK_TYPE = 'thinking'
const CONTINUE_OPTIONS_TAG = '<options>{"1":"Continue"}</options>'

export function createUserMessage(
  content: string,
  fileAttachments?: MessageFileAttachment[],
  contexts?: ChatContext[],
  messageId?: string
): CopilotMessage {
  return {
    id: messageId || crypto.randomUUID(),
    role: 'user',
    content,
    timestamp: new Date().toISOString(),
    ...(fileAttachments && fileAttachments.length > 0 && { fileAttachments }),
    ...(contexts && contexts.length > 0 && { contexts }),
    ...(contexts &&
      contexts.length > 0 && {
        contentBlocks: [{ type: 'contexts', contexts, timestamp: Date.now() }],
      }),
  }
}

export function createStreamingMessage(): CopilotMessage {
  return {
    id: crypto.randomUUID(),
    role: 'assistant',
    content: '',
    timestamp: new Date().toISOString(),
  }
}

export function createErrorMessage(
  messageId: string,
  content: string,
  errorType?: 'usage_limit' | 'unauthorized' | 'forbidden' | 'rate_limit' | 'upgrade_required'
): CopilotMessage {
  return {
    id: messageId,
    role: 'assistant',
    content,
    timestamp: new Date().toISOString(),
    contentBlocks: [
      {
        type: 'text',
        content,
        timestamp: Date.now(),
      },
    ],
    errorType,
  }
}

export function appendTextBlock(context: ClientStreamingContext, text: string) {
  if (!text) return
  context.accumulatedContent += text
  if (context.currentTextBlock && context.contentBlocks.length > 0) {
    const lastBlock = context.contentBlocks[context.contentBlocks.length - 1]
    if (lastBlock.type === TEXT_BLOCK_TYPE && lastBlock === context.currentTextBlock) {
      lastBlock.content += text
      return
    }
  }
  const newBlock: ClientContentBlock = { type: 'text', content: text, timestamp: Date.now() }
  context.currentTextBlock = newBlock
  context.contentBlocks.push(newBlock)
}

export function appendContinueOption(content: string): string {
  if (/<options>/i.test(content)) return content
  const suffix = content.trim().length > 0 ? '\n\n' : ''
  return `${content}${suffix}${CONTINUE_OPTIONS_TAG}`
}

export function appendContinueOptionBlock(blocks: ClientContentBlock[]): ClientContentBlock[] {
  if (!Array.isArray(blocks)) return blocks
  const hasOptions = blocks.some(
    (block) =>
      block?.type === TEXT_BLOCK_TYPE &&
      typeof block.content === 'string' &&
      /<options>/i.test(block.content)
  )
  if (hasOptions) return blocks
  return [
    ...blocks,
    {
      type: TEXT_BLOCK_TYPE,
      content: CONTINUE_OPTIONS_TAG,
      timestamp: Date.now(),
    },
  ]
}

export function stripContinueOption(content: string): string {
  if (!content || !content.includes(CONTINUE_OPTIONS_TAG)) return content
  const next = content.replace(CONTINUE_OPTIONS_TAG, '')
  return next.replace(/\n{2,}\s*$/g, '\n').trimEnd()
}

export function stripContinueOptionFromBlocks(blocks: ClientContentBlock[]): ClientContentBlock[] {
  if (!Array.isArray(blocks)) return blocks
  return blocks.flatMap((block) => {
    if (
      block?.type === TEXT_BLOCK_TYPE &&
      typeof block.content === 'string' &&
      block.content.includes(CONTINUE_OPTIONS_TAG)
    ) {
      const nextContent = stripContinueOption(block.content)
      if (!nextContent.trim()) return []
      return [{ ...block, content: nextContent }]
    }
    return [block]
  })
}

export function beginThinkingBlock(context: ClientStreamingContext) {
  if (!context.currentThinkingBlock) {
    const newBlock: ClientContentBlock = {
      type: 'thinking',
      content: '',
      timestamp: Date.now(),
      startTime: Date.now(),
    }
    context.currentThinkingBlock = newBlock
    context.contentBlocks.push(newBlock)
  }
  context.isInThinkingBlock = true
  context.currentTextBlock = null
}

export function finalizeThinkingBlock(context: ClientStreamingContext) {
  if (context.currentThinkingBlock) {
    context.currentThinkingBlock.duration =
      Date.now() - (context.currentThinkingBlock.startTime || Date.now())
  }
  context.isInThinkingBlock = false
  context.currentThinkingBlock = null
  context.currentTextBlock = null
}

import { MothershipStreamV1TextChannel } from '@/lib/copilot/generated/mothership-stream-v1'
import type { StreamingContext } from '@/lib/copilot/request/types'
import type { StreamHandler, ToolScope } from './types'
import {
  addContentBlock,
  flushSubagentThinkingBlock,
  flushThinkingBlock,
  getScopedParentToolCallId,
  getScopedSpanIdentity,
} from './types'

const INTENT_OPEN = '<intent>'
const INTENT_CLOSE = '</intent>'
/** A tag that never closes within this many chars flushes back as plain text. */
const INTENT_CARRY_MAX = 240

function partialSuffixLen(buf: string, token: string): number {
  const max = Math.min(buf.length, token.length - 1)
  for (let len = max; len > 0; len--) {
    if (token.startsWith(buf.slice(buf.length - len))) return len
  }
  return 0
}

/**
 * Streams one subagent lane's text through the <intent> protocol: complete
 * tags are removed from the persisted prose and the latest one is returned;
 * a tag split across chunks is carried (per lane) until its close arrives.
 */
function filterLaneIntent(
  context: StreamingContext,
  laneId: string,
  incoming: string
): { text: string; intent?: string } {
  const carries = (context.subagentIntentCarry ??= {})
  let buf = (carries[laneId] ?? '') + incoming
  carries[laneId] = ''
  let out = ''
  let intent: string | undefined
  while (buf) {
    const openIdx = buf.indexOf(INTENT_OPEN)
    if (openIdx === -1) {
      const keep = partialSuffixLen(buf, INTENT_OPEN)
      out += keep ? buf.slice(0, buf.length - keep) : buf
      if (keep) carries[laneId] = buf.slice(buf.length - keep)
      break
    }
    out += buf.slice(0, openIdx)
    const rest = buf.slice(openIdx)
    const closeIdx = rest.indexOf(INTENT_CLOSE, INTENT_OPEN.length)
    if (closeIdx === -1) {
      if (rest.length > INTENT_CARRY_MAX) {
        out += rest
      } else {
        carries[laneId] = rest
      }
      break
    }
    const inner = rest.slice(INTENT_OPEN.length, closeIdx).trim()
    if (inner) intent = inner
    buf = rest.slice(closeIdx + INTENT_CLOSE.length)
    if (buf.startsWith('\n')) buf = buf.slice(1)
  }
  return intent !== undefined ? { text: out, intent } : { text: out }
}

/** Stamps the latest intent onto the lane's open `subagent` start block. */
function stampLaneIntent(context: StreamingContext, laneId: string, intent: string): void {
  for (let i = context.contentBlocks.length - 1; i >= 0; i--) {
    const b = context.contentBlocks[i]
    if (b.type === 'subagent' && b.parentToolCallId === laneId) {
      b.subagentIntent = intent
      return
    }
  }
}

export function handleTextEvent(scope: ToolScope): StreamHandler {
  return (event, context) => {
    if (event.type !== 'text') {
      return
    }

    const chunk = event.payload.text
    if (!chunk) {
      return
    }

    if (scope === 'subagent') {
      const parentToolCallId = getScopedParentToolCallId(event, context)
      if (!parentToolCallId) return
      const spanIdentity = getScopedSpanIdentity(event)
      if (event.payload.channel === MothershipStreamV1TextChannel.thinking) {
        // Per-lane thinking: each concurrent subagent accumulates into its own
        // block keyed by parentToolCallId, so interleaved chunks from a sibling
        // subagent never flush or corrupt this lane's reasoning.
        let block = context.subagentThinkingBlocks.get(parentToolCallId)
        if (!block) {
          block = {
            type: 'subagent_thinking',
            content: '',
            parentToolCallId,
            ...(event.scope?.agentId ? { subagent: event.scope.agentId } : {}),
            ...spanIdentity,
            timestamp: Date.now(),
          }
          context.subagentThinkingBlocks.set(parentToolCallId, block)
        }
        block.content = `${block.content || ''}${chunk}`
        return
      }
      // Real text for this lane: close this lane's thinking block first so the
      // persisted order is [thinking, text] within the lane.
      flushSubagentThinkingBlock(context, parentToolCallId)
      if (context.isInThinkingBlock) {
        flushThinkingBlock(context)
      }
      // Catch the lane's <intent> protocol server-side: the latest tag becomes
      // the persisted subagent block's status and the stored prose is stripped,
      // so every surface (live, persisted, replay) agrees on both.
      const { text: cleanChunk, intent } = filterLaneIntent(context, parentToolCallId, chunk)
      if (intent) stampLaneIntent(context, parentToolCallId, intent)
      if (!cleanChunk) return
      context.subAgentContent[parentToolCallId] =
        (context.subAgentContent[parentToolCallId] || '') + cleanChunk
      addContentBlock(context, {
        type: 'subagent_text',
        content: cleanChunk,
        parentToolCallId,
        ...(event.scope?.agentId ? { subagent: event.scope.agentId } : {}),
        ...spanIdentity,
      })
      return
    }

    if (event.payload.channel === MothershipStreamV1TextChannel.thinking) {
      if (!context.currentThinkingBlock) {
        context.currentThinkingBlock = {
          type: 'thinking',
          content: '',
          timestamp: Date.now(),
        }
        context.isInThinkingBlock = true
      }
      context.currentThinkingBlock.content = `${context.currentThinkingBlock.content || ''}${chunk}`
      return
    }

    if (context.isInThinkingBlock) {
      flushThinkingBlock(context)
    }
    context.accumulatedContent += chunk
    context.finalAssistantContent += chunk
    addContentBlock(context, { type: 'text', content: chunk })
  }
}

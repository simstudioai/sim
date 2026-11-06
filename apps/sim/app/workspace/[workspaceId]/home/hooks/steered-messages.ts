import type { ChatMessage, ContentBlock } from '@/app/workspace/[workspaceId]/home/types'

interface SteeringBlockCarrier {
  type: string
  steering?: { steeringId: string }
}

/** Ids of the steering messages these blocks show their turn applied. */
export function appliedSteeringIds(
  blocks: readonly SteeringBlockCarrier[] | undefined,
  into: Set<string> = new Set()
): Set<string> {
  for (const block of blocks ?? []) {
    if (block.type === 'steering' && block.steering) into.add(block.steering.steeringId)
  }
  return into
}

/** A message on its way into a turn: its bubble, the turn, and where it applied, once known. */
export interface OutgoingPlacement {
  message: ChatMessage
  streamId?: string
  /** The length of the turn's answer when it applied the message (UTF-16 code units). */
  textOffset?: number
}

const isMainText = (block: ContentBlock) => block.type === 'text' && !block.spanId

/**
 * The blocks with a steering marker for `steeringId` at `textOffset` of their main
 * answer, splitting the text block that offset falls in. It is where the turn's
 * own `steering_applied` frame puts the marker (the worker reports the answer's
 * length at that point), so an `applied` answer places the message before the
 * frame arrives, and identically.
 */
function withSteeringAt(
  blocks: ContentBlock[],
  steeringId: string,
  textOffset: number
): ContentBlock[] {
  const marker: ContentBlock = { type: 'steering', steering: { steeringId } }
  const result: ContentBlock[] = []
  let seen = 0
  let placed = false
  for (const block of blocks) {
    if (placed || !isMainText(block)) {
      result.push(block)
      continue
    }
    const text = block.content ?? ''
    if (seen + text.length < textOffset) {
      seen += text.length
      result.push(block)
      continue
    }
    const cut = Math.max(0, textOffset - seen)
    if (cut > 0) result.push({ ...block, content: text.slice(0, cut) })
    result.push(marker)
    if (cut < text.length) result.push({ ...block, content: text.slice(cut) })
    placed = true
  }
  if (!placed) result.push(marker)
  return result
}

/**
 * The message a running turn is streaming into: the last assistant message, since
 * messages still on their way into the turn show after it.
 */
export function findLiveResponseId(messages: readonly ChatMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index].role === 'assistant') return messages[index].id
  }
  return undefined
}

function mainText(blocks: ContentBlock[]): string {
  return blocks
    .filter(isMainText)
    .map((block) => block.content ?? '')
    .join('')
}

/**
 * Places each message the user sent into a running turn where that turn applied
 * it. An assistant message whose blocks mark an applied steering message splits
 * there: the response before it, the user's message, then the rest. Its last
 * segment keeps the message's id, so the live turn stays the same row.
 *
 * A steering message not placed shows after everything else, never hidden: it is
 * still on its way, or its delivery is being settled (a turn that ended without
 * applying it sends it on as a turn under the same id, which replaces it). One the
 * worker said it applied (`textOffset`) is placed in its turn's answer at that
 * offset until the turn's own marker for it arrives.
 */
export function placeSteeredMessages(
  source: ChatMessage[],
  outgoing: readonly OutgoingPlacement[]
): ChatMessage[] {
  if (outgoing.length === 0 && !source.some((message) => message.steering)) return source
  const steered = new Map<string, ChatMessage>()
  for (const message of source) {
    if (message.role === 'user' && message.steering) steered.set(message.id, message)
  }
  for (const { message } of outgoing) steered.set(message.id, message)
  let messages = source
  for (const { message, streamId, textOffset } of outgoing) {
    if (!streamId || textOffset === undefined) continue
    messages = messages.map((candidate) =>
      candidate.role === 'assistant' &&
      candidate.streamId === streamId &&
      !appliedSteeringIds(candidate.contentBlocks).has(message.id)
        ? {
            ...candidate,
            contentBlocks: withSteeringAt(candidate.contentBlocks ?? [], message.id, textOffset),
          }
        : candidate
    )
  }

  const placed = new Set<string>()
  const result: ChatMessage[] = []
  for (const message of messages) {
    if (message.role === 'user' && message.steering) continue
    const blocks = message.contentBlocks
    if (
      message.role !== 'assistant' ||
      !blocks?.some((block) => block.steering && steered.has(block.steering.steeringId))
    ) {
      result.push(message)
      continue
    }
    let segment: ContentBlock[] = []
    for (const block of blocks) {
      const steering = block.steering ? steered.get(block.steering.steeringId) : undefined
      if (block.type !== 'steering') {
        segment.push(block)
        continue
      }
      if (!steering || placed.has(steering.id)) continue
      if (segment.length > 0) {
        result.push({
          ...message,
          id: `${message.id}:before:${steering.id}`,
          content: mainText(segment),
          contentBlocks: segment,
        })
      }
      result.push(steering)
      placed.add(steering.id)
      segment = []
    }
    result.push({ ...message, content: mainText(segment), contentBlocks: segment })
  }

  /* Never hidden: a message not placed in its turn shows after everything else,
     whether it is still on its way or its delivery is being settled. */
  for (const [id, message] of steered) {
    if (!placed.has(id)) result.push(message)
  }
  return result
}

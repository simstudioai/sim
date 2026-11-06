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

function mainText(blocks: ContentBlock[]): string {
  return blocks
    .filter((block) => block.type === 'text' && !block.spanId)
    .map((block) => block.content ?? '')
    .join('')
}

/**
 * Places each message the user sent into a running turn where that turn applied
 * it. An assistant message whose blocks mark an applied steering message splits
 * there: the response before it, the user's message, then the rest. Its last
 * segment keeps the message's id, so the live turn stays the same row.
 *
 * A steering message not applied yet shows after everything else while it may
 * still be: when it is `outgoing` (this client is still delivering it) or its
 * turn (`streamId`) is one of `liveStreamIds`. Otherwise it is dropped, because
 * a turn that ended without applying it hands it on as an ordinary turn under
 * another id, which shows on its own.
 */
export function placeSteeredMessages(
  messages: ChatMessage[],
  outgoing: readonly ChatMessage[],
  liveStreamIds: ReadonlySet<string>
): ChatMessage[] {
  if (outgoing.length === 0 && !messages.some((message) => message.steering)) return messages
  const steered = new Map<string, ChatMessage>()
  for (const message of messages) {
    if (message.role === 'user' && message.steering) steered.set(message.id, message)
  }
  const outgoingIds = new Set<string>()
  for (const message of outgoing) {
    steered.set(message.id, message)
    outgoingIds.add(message.id)
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

  for (const [id, message] of steered) {
    if (placed.has(id)) continue
    const streamId = message.steering?.streamId
    if (outgoingIds.has(id) || (streamId && liveStreamIds.has(streamId))) result.push(message)
  }
  return result
}

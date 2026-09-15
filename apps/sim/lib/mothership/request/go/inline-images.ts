import { createLogger } from '@sim/logger'
import { materializeStreamImage } from '@/lib/mothership/chat/application/inline-images'
import { isInlineFileReference } from '@/lib/mothership/chat/inline-image-reference'
import { collectMarkdownImageSources } from '@/lib/mothership/chat/markdown-images'
import type {
  ExecutionContext,
  StreamEvent,
  StreamingContext,
} from '@/lib/mothership/request/types'

const logger = createLogger('ChatInlineImages')
const MAX_INLINE_IMAGES_PER_TURN = 20

/** Snapshot explicit images before their Markdown arrives; receipt text stays byte-for-byte intact. */
export async function prepareStreamImages(
  event: StreamEvent,
  context: StreamingContext,
  execution: ExecutionContext,
  attempted: Set<string>,
  signal?: AbortSignal
): Promise<void> {
  if (event.scope?.lane === 'subagent') return
  if (event.type !== 'complete' && (event.type !== 'text' || event.payload.channel !== 'assistant'))
    return
  if (event.type === 'text' && !/[)\]\n]/.test(event.payload.text)) return
  const { chatId, requestId } = context
  if (!chatId || !requestId || !execution.workspaceId || execution.copilotToolExecution !== true)
    return
  if (attempted.size >= MAX_INLINE_IMAGES_PER_TURN) return
  const content = context.accumulatedContent + (event.type === 'text' ? event.payload.text : '')
  if (!content.includes('![')) return
  const sources = collectMarkdownImageSources(content)
  for (const reference of sources) {
    if (attempted.size >= MAX_INLINE_IMAGES_PER_TURN) break
    if (!isInlineFileReference(reference) || attempted.has(reference)) continue
    attempted.add(reference)
    signal?.throwIfAborted()
    try {
      await materializeStreamImage(
        {
          userId: execution.userId,
          workspaceId: execution.workspaceId,
          chatId,
        },
        { requestId, reference, signal }
      )
    } catch (error) {
      signal?.throwIfAborted()
      // Failed images remain unavailable; they cannot terminate an otherwise valid answer.
      logger.warn('Could not prepare inline chat image', {
        chatId,
        requestId,
        errorType: error instanceof Error ? error.name : 'UnknownError',
      })
    }
  }
}

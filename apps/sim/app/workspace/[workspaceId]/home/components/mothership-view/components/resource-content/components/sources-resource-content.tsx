'use client'

import { toDisplayMessage } from '@/lib/mothership/chat/display-message'
import type { MothershipResource } from '@/lib/mothership/resources/types'
import { SourceCard } from '@/app/workspace/[workspaceId]/home/components/message-content/components/source-card'
import { collectCitedMessageSources } from '@/app/workspace/[workspaceId]/home/components/message-content/message-sources'
import { useMothershipChatHistory } from '@/hooks/queries/mothership-chats'

interface SourcesResourceContentProps {
  resource: MothershipResource
  chatId?: string
}

/** The chat already owns this evidence; opening the panel never repeats provider searches. */
export function SourcesResourceContent({ resource, chatId }: SourcesResourceContentProps) {
  const history = useMothershipChatHistory(chatId)
  const address = resource.sources
  const persisted = history.data?.messages.find(
    (message) =>
      message.role === 'assistant' &&
      (message.id === address?.messageId ||
        (address?.requestId && message.requestId === address.requestId))
  )
  const message = persisted ? toDisplayMessage(persisted) : undefined
  const sources = message
    ? collectCitedMessageSources(message.contentBlocks ?? [], message.content)
    : []
  return (
    <div className='h-full overflow-y-auto px-4 py-3' aria-label='Cited sources'>
      <div className='mb-3 font-medium text-[var(--text-primary)] text-sm'>
        Sources{sources.length ? ` · ${sources.length}` : ''}
      </div>
      {sources.length ? (
        sources.map((source) => <SourceCard key={source.url} source={source} />)
      ) : (
        <p className='text-[var(--text-muted)] text-sm'>
          {history.isPending
            ? 'Loading sources…'
            : history.isError
              ? 'Unable to load sources. Try reopening this conversation.'
              : 'No cited sources are available for this response.'}
        </p>
      )}
    </div>
  )
}

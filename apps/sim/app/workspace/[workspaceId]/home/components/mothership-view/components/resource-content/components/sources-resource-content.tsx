'use client'

import { useRef } from 'react'
import { cn, scrollFadeAttributes, scrollFadeClass, useScrollEdges } from '@sim/emcn'
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
  const scrollRef = useRef<HTMLDivElement>(null)
  const edges = useScrollEdges(scrollRef)
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
    <div
      ref={scrollRef}
      className={cn('h-full overflow-y-auto p-2', scrollFadeClass)}
      {...scrollFadeAttributes(edges)}
      aria-label='Cited sources'
    >
      <div>
        <h2 className='px-2 py-2 text-[var(--text-body)] text-small'>
          Sources
          <span className='text-[var(--text-muted)]'>
            {sources.length ? ` · ${sources.length}` : ''}
          </span>
        </h2>
        {sources.length ? (
          sources.map((source) => <SourceCard key={source.url} source={source} />)
        ) : (
          <p className='px-2 py-2 text-[var(--text-muted)] text-small'>
            {history.isPending
              ? 'Loading sources…'
              : history.isError
                ? 'Unable to load sources. Try reopening this conversation.'
                : 'No cited sources are available for this response.'}
          </p>
        )}
      </div>
    </div>
  )
}

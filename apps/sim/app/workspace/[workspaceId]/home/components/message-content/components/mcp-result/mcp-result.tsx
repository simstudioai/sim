'use client'

import { useRef, useState } from 'react'
import { Chip, ChipLink } from '@sim/emcn'
import { type McpPresentationReceipt, mcpPresentationAssetUrl } from '@/lib/mcp/presentation'
import { useChatSurface } from '@/app/workspace/[workspaceId]/home/components/chat-surface-context'
import { McpApp } from '@/app/workspace/[workspaceId]/home/components/message-content/components/mcp-result/mcp-app'
import { useOptionalMothershipResources } from '@/app/workspace/[workspaceId]/home/components/mothership-resources-context'

interface McpResultProps {
  receipt: McpPresentationReceipt
}

export function McpResult({ receipt }: McpResultProps) {
  const { chatId } = useChatSurface()
  const resources = useOptionalMothershipResources()
  const [appOpen, setAppOpen] = useState(false)
  const openButtonRef = useRef<HTMLButtonElement>(null)
  if (!chatId) return null
  return (
    <div className='flex min-w-0 flex-col gap-3 py-2'>
      {receipt.hasApp && (
        <div className='flex items-center gap-2'>
          <Chip
            ref={openButtonRef}
            variant='border'
            active={appOpen}
            onClick={() => setAppOpen(true)}
            aria-expanded={appOpen}
          >
            {`Open ${receipt.title}`}
          </Chip>
        </div>
      )}
      {appOpen && (
        <McpApp
          key={`${chatId}:${receipt.id}`}
          chatId={chatId}
          id={receipt.id}
          onClose={() => {
            setAppOpen(false)
            openButtonRef.current?.focus()
          }}
        />
      )}
      {receipt.items.map((item) => {
        const url = mcpPresentationAssetUrl(chatId, receipt.id, item.index)
        return (
          <div
            key={`${item.identity}:${item.index}`}
            className='flex min-w-0 flex-col items-start gap-2'
          >
            {item.kind === 'image' && (
              <img
                src={url}
                alt={item.title}
                loading='lazy'
                className='max-h-[400px] max-w-full rounded-lg object-contain'
              />
            )}
            {item.kind === 'audio' && (
              // biome-ignore lint/a11y/useMediaCaption: MCP audio results do not include a caption track.
              <audio src={url} controls preload='none' aria-label={item.title} />
            )}
            {resources ? (
              <Chip
                variant='border'
                onClick={() =>
                  resources?.addResource({
                    type: 'mcp',
                    id: item.identity,
                    title: item.title,
                    mcp: { presentationId: receipt.id, index: item.index },
                  })
                }
              >
                {item.title}
              </Chip>
            ) : (
              <ChipLink
                href={url}
                target='_blank'
                rel='noopener noreferrer'
                prefetch={false}
                variant='border'
              >
                {item.title}
              </ChipLink>
            )}
          </div>
        )
      })}
    </div>
  )
}

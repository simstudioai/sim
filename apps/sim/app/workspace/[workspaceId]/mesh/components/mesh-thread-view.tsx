'use client'

import { useEffect, useRef } from 'react'
import { createLogger } from '@sim/logger'
import { ArrowLeft, Loader2, RefreshCw } from 'lucide-react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Button, Tooltip } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { useMeshThreadDetail } from '@/hooks/queries/mesh'
import type { MeshMessage } from '@/hooks/queries/mesh'
import { AgentAvatar } from '@/app/workspace/[workspaceId]/mesh/components/agent-avatar'
import { ThreadStatusBadge } from '@/app/workspace/[workspaceId]/mesh/components/thread-status-badge'

const logger = createLogger('MeshThreadView')

interface MeshThreadViewProps {
  contextId: string
}

/**
 * Detail view for a single mesh conversation thread.
 * Renders messages in a chat-like layout with agent avatars on the left.
 */
export function MeshThreadView({ contextId }: MeshThreadViewProps) {
  const routeParams = useParams()
  const workspaceId = routeParams.workspaceId as string
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const { data: thread, isLoading, isError, error, refetch, isFetching } =
    useMeshThreadDetail(contextId)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [thread?.messages?.length])

  const displayTitle = thread
    ? thread.title.replace(/^conv:\s*/i, '').replace(/^mesh::\s*/i, '')
    : 'Loading...'

  const agentMap = new Map(thread?.agents.map((a) => [a.id, a]) ?? [])

  return (
    <div className='flex h-full flex-1 flex-col overflow-hidden bg-white dark:bg-[var(--bg)]'>
      {/* Header */}
      <div className='flex shrink-0 items-center gap-[12px] border-b border-[var(--border)] px-[24px] py-[14px]'>
        <Link href={`/workspace/${workspaceId}/mesh`}>
          <Button variant='ghost' className='p-[4px]'>
            <ArrowLeft className='h-[16px] w-[16px]' />
          </Button>
        </Link>

        <div className='flex flex-1 flex-col'>
          <h1 className='font-semibold text-[16px] text-[var(--text-primary)]'>
            {displayTitle}
          </h1>
          {thread && (
            <div className='flex items-center gap-[8px] text-[12px] text-[var(--text-tertiary)]'>
              <ThreadStatusBadge status={thread.status} />
              <span>{thread.turnCount} turns</span>
              <span>·</span>
              <span>{thread.agents.length} agents</span>
            </div>
          )}
        </div>

        {/* Agent legend */}
        {thread && (
          <div className='flex items-center gap-[8px]'>
            {thread.agents.map((agent) => (
              <div key={agent.id} className='flex items-center gap-[4px]'>
                <div
                  className='h-[8px] w-[8px] rounded-full'
                  style={{ backgroundColor: agent.color || '#6366f1' }}
                />
                <span className='text-[11px] text-[var(--text-tertiary)]'>{agent.name}</span>
              </div>
            ))}
          </div>
        )}

        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <Button variant='ghost' onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw
                className={cn('h-[14px] w-[14px]', isFetching && 'animate-spin')}
              />
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content>
            <p>Refresh</p>
          </Tooltip.Content>
        </Tooltip.Root>
      </div>

      {/* Messages */}
      <div className='flex-1 overflow-y-auto px-[24px] py-[16px]'>
        {isLoading ? (
          <div className='flex items-center justify-center py-[60px]'>
            <Loader2 className='h-[16px] w-[16px] animate-spin text-[var(--text-secondary)]' />
            <span className='ml-[8px] text-[13px] text-[var(--text-secondary)]'>
              Loading conversation...
            </span>
          </div>
        ) : isError ? (
          <div className='flex items-center justify-center py-[60px]'>
            <span className='text-[13px] text-[var(--text-error)]'>
              {error?.message || 'Failed to load thread'}
            </span>
          </div>
        ) : thread?.messages.length === 0 ? (
          <div className='flex items-center justify-center py-[60px]'>
            <span className='text-[13px] text-[var(--text-secondary)]'>
              No messages in this thread
            </span>
          </div>
        ) : (
          <div className='mx-auto max-w-[720px] space-y-[4px]'>
            {thread?.messages.map((message, idx) => {
              const prevMessage = idx > 0 ? thread.messages[idx - 1] : null
              const showAvatar =
                !prevMessage ||
                prevMessage.agentId !== message.agentId ||
                prevMessage.role !== message.role

              return (
                <MessageBubble
                  key={message.id}
                  message={message}
                  agent={message.agentId ? agentMap.get(message.agentId) : undefined}
                  showAvatar={showAvatar}
                />
              )
            })}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>
    </div>
  )
}

interface MessageBubbleProps {
  message: MeshMessage
  agent?: { id: string; name: string; node: string; color: string }
  showAvatar: boolean
}

function MessageBubble({ message, agent, showAvatar }: MessageBubbleProps) {
  const isSystem = message.role === 'system'

  if (isSystem) {
    return (
      <div className='flex justify-center py-[4px]'>
        <span className='rounded-[6px] bg-[var(--surface-3)] px-[10px] py-[3px] text-center text-[11px] text-[var(--text-tertiary)] italic'>
          {message.content}
        </span>
      </div>
    )
  }

  return (
    <div className={cn('flex gap-[10px]', showAvatar ? 'pt-[12px]' : 'pt-[2px]')}>
      {/* Avatar column */}
      <div className='w-[28px] shrink-0'>
        {showAvatar && agent && <AgentAvatar agent={agent} size='md' />}
      </div>

      {/* Message content */}
      <div className='flex-1 min-w-0'>
        {showAvatar && (
          <div className='mb-[3px] flex items-center gap-[6px]'>
            <span
              className='font-semibold text-[12px]'
              style={{ color: agent?.color || 'var(--text-primary)' }}
            >
              {message.agentName || agent?.name || message.role}
            </span>
            <span className='text-[11px] text-[var(--text-subtle)]'>
              {formatTimestamp(message.timestamp)}
            </span>
          </div>
        )}
        <div className='rounded-[8px] bg-[var(--surface-2)] px-[12px] py-[8px] text-[13px] leading-[1.6] text-[var(--text-primary)] dark:bg-[var(--surface-3)]'>
          <MessageContent content={message.content} />
        </div>
      </div>
    </div>
  )
}

function MessageContent({ content }: { content: string }) {
  if (content.includes('```')) {
    const parts = content.split(/(```[\s\S]*?```)/g)
    return (
      <>
        {parts.map((part, i) => {
          if (part.startsWith('```')) {
            const codeContent = part.replace(/^```\w*\n?/, '').replace(/\n?```$/, '')
            return (
              <pre
                key={i}
                className='my-[6px] overflow-x-auto rounded-[6px] bg-[var(--surface-4)] p-[10px] font-mono text-[12px] text-[var(--text-secondary)]'
              >
                {codeContent}
              </pre>
            )
          }
          return <span key={i}>{part}</span>
        })}
      </>
    )
  }

  return <>{content}</>
}

function formatTimestamp(isoDate: string): string {
  const date = new Date(isoDate)
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

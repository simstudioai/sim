'use client'

import { useState } from 'react'
import { Chip, cn, OverflowText, Popover, PopoverContent, PopoverTrigger } from '@sim/emcn'
import { ChevronRight, List, Users } from '@sim/emcn/icons'
import type { NestedAgentGroup } from '@/app/workspace/[workspaceId]/home/components/message-content/components/agent-group/agent-group-view'
import { SourceCard } from '@/app/workspace/[workspaceId]/home/components/message-content/components/source-card'
import { parseBlocks } from '@/app/workspace/[workspaceId]/home/components/message-content/message-content'
import { collectCitedMessageSources } from '@/app/workspace/[workspaceId]/home/components/message-content/message-sources'
import type { ChatMessage } from '@/app/workspace/[workspaceId]/home/types'

type ChatAgentActivity = NestedAgentGroup & { key: string; live: boolean }

interface ChatDetailsProps {
  title: string
  messages: ChatMessage[]
  isSending: boolean
}

/** Live and saved sub-agent activity and cited sources owned by this conversation. */
export function ChatDetails({ title, messages, isSending }: ChatDetailsProps) {
  const [open, setOpen] = useState(false)
  const [allSources, setAllSources] = useState(false)
  const agents: ChatAgentActivity[] = []
  const sources = new Map<string, ReturnType<typeof collectCitedMessageSources>[number]>()
  for (const [index, message] of messages.entries()) {
    if (message.role !== 'assistant') continue
    const live = isSending && index === messages.length - 1
    for (const segment of parseBlocks(message.contentBlocks ?? [], live)) {
      if (segment.type === 'agent_group') {
        const collect = (group: NestedAgentGroup) => {
          if (group.agentName !== 'mothership')
            agents.push({ ...group, key: `${message.id}:${group.id}`, live })
          for (const item of group.items) if (item.type === 'agent_group') collect(item.group)
        }
        collect(segment)
      }
    }
    for (const source of collectCitedMessageSources(message.contentBlocks ?? [], message.content)) {
      sources.set(source.url, source)
    }
  }
  const done = agents.filter((agent) => !agent.isOpen && !agent.error).length
  const working = agents.filter((agent) => agent.live && agent.isOpen && !agent.error).length
  const details = (
    <div className='divide-y divide-[var(--border)]'>
      <section className='p-4' aria-label='Sub-agents'>
        <div className='mb-3 flex items-center justify-between text-small'>
          <h3 className='text-[var(--text-muted)]'>Sub-agents</h3>
          <span className='text-[var(--text-muted)]'>
            {working
              ? `${working} working${done ? ` · ${done} done` : ''}`
              : `${agents.length} total`}
          </span>
        </div>
        {agents.length ? (
          agents.map((agent) => (
            <details key={agent.key} className='group py-1'>
              <summary className='flex cursor-pointer list-none items-center gap-2 rounded-lg px-2 py-2 hover:bg-[var(--surface-hover)]'>
                <Users
                  className={cn(
                    'size-4 shrink-0',
                    agent.live && agent.isOpen
                      ? 'text-[var(--brand-blue)]'
                      : 'text-[var(--text-icon)]'
                  )}
                />
                <OverflowText
                  label={agent.agentLabel || agent.agentName}
                  className='min-w-0 flex-1 text-small'
                />
                <span className='shrink-0 text-[var(--text-muted)] text-caption'>
                  {agent.error
                    ? 'Failed'
                    : agent.isOpen
                      ? agent.live
                        ? 'Working'
                        : 'Stopped'
                      : 'Done'}
                </span>
                <ChevronRight className='size-3 shrink-0 text-[var(--text-icon)] group-open:rotate-90' />
              </summary>
              <div className='ml-8 border-[var(--border)] border-l px-3 py-2 text-[var(--text-secondary)] text-caption'>
                {agent.error ? <p>{agent.error}</p> : null}
                {agent.items
                  .filter((item) => item.type !== 'text')
                  .map((item, index) => (
                    <p key={index} className='flex items-center justify-between gap-2 py-1'>
                      <span>
                        {item.type === 'tool'
                          ? item.data.displayTitle || item.data.toolName.replaceAll('_', ' ')
                          : item.group.agentLabel}
                      </span>
                      {item.type === 'tool' ? (
                        <span className='text-[var(--text-muted)]'>
                          {item.data.status === 'executing'
                            ? 'Working'
                            : item.data.status === 'success'
                              ? 'Done'
                              : item.data.status.replaceAll('_', ' ')}
                        </span>
                      ) : null}
                    </p>
                  ))}
                {!agent.items.some((item) => item.type !== 'text') && !agent.error ? (
                  <p>No tool activity recorded.</p>
                ) : null}
              </div>
            </details>
          ))
        ) : (
          <p className='text-[var(--text-muted)] text-small'>
            Sub-agents will appear here when Sim delegates work.
          </p>
        )}
      </section>
      <section className='p-4' aria-label='Chat sources'>
        <div className='mb-2 flex items-center justify-between text-[var(--text-muted)] text-small'>
          <h3>Sources</h3>
          <span>{sources.size}</span>
        </div>
        {sources.size ? (
          <>
            {[...sources.values()].slice(0, allSources ? undefined : 5).map((source) => (
              <SourceCard key={source.url} source={source} dense />
            ))}
            {sources.size > 5 ? (
              <Chip onClick={() => setAllSources(!allSources)}>
                {allSources ? 'Show fewer' : `View all ${sources.size} sources`}
              </Chip>
            ) : null}
          </>
        ) : (
          <p className='text-[var(--text-muted)] text-small'>
            Sources cited in this conversation will appear here.
          </p>
        )}
      </section>
    </div>
  )
  return (
    <header className='flex h-[calc(var(--resource-header-controls-height)+1px)] shrink-0 items-center gap-2 border-[var(--border)] border-b px-4'>
      <OverflowText label={title} className='min-w-0 flex-1 text-[var(--text-body)] text-small' />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Chip aria-label='Chat details' active={open}>
            <List className='size-4' />
            {working > 0 ? <span className='text-caption'>{working}</span> : null}
          </Chip>
        </PopoverTrigger>
        <PopoverContent align='end' className='w-[340px] max-w-[calc(100vw-32px)] p-0'>
          <div className='max-h-[60vh] overflow-y-auto'>{details}</div>
        </PopoverContent>
      </Popover>
    </header>
  )
}

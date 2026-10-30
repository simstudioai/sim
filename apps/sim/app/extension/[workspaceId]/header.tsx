'use client'

import {
  Chip,
  ChipLink,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tooltip,
} from '@sim/emcn'
import { ArrowUpRight, BubbleChatDelay, ChevronDown, Plus } from '@sim/emcn/icons'
import { useRouter } from 'next/navigation'
import type { useMothershipChats } from '@/hooks/queries/mothership-chats'
import { useWorkspacesQuery } from '@/hooks/queries/workspace'

interface ExtensionHeaderProps {
  workspaceId?: string
  scopeName: string
  history: Pick<ReturnType<typeof useMothershipChats>, 'data' | 'isPending' | 'error'>
  chatId?: string
  onSelectChat: (chatId: string | null) => void
  appHref: string
}

export function ExtensionHeader({
  workspaceId,
  scopeName,
  history,
  chatId,
  onSelectChat,
  appHref,
}: ExtensionHeaderProps) {
  const router = useRouter()
  const { data: workspaces } = useWorkspacesQuery()
  const { data: chats, isPending, error } = history
  return (
    <header className='flex shrink-0 items-center gap-1 border-[var(--border)] border-b px-3 py-2'>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Chip rightIcon={ChevronDown} className='mr-auto min-w-0'>
            {scopeName}
          </Chip>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='start'>
          <DropdownMenuItem
            active={!workspaceId}
            disabled={!workspaceId}
            onSelect={() => router.push('/extension')}
          >
            Organization chat
          </DropdownMenuItem>
          {Boolean(workspaces?.length) && <DropdownMenuSeparator />}
          {workspaces?.map((workspace) => (
            <DropdownMenuItem
              key={workspace.id}
              active={workspace.id === workspaceId}
              disabled={workspace.id === workspaceId}
              onSelect={() => {
                if (workspace.id !== workspaceId)
                  router.push(`/extension/${encodeURIComponent(workspace.id)}`)
              }}
            >
              {workspace.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <DropdownMenuTrigger asChild>
              <Chip shape='round' leftIcon={BubbleChatDelay} aria-label='Chat history' />
            </DropdownMenuTrigger>
          </Tooltip.Trigger>
          <Tooltip.Content>Chat history</Tooltip.Content>
        </Tooltip.Root>
        <DropdownMenuContent align='end' className='max-h-[320px] w-[240px] overflow-y-auto'>
          {isPending || error || !chats?.length ? (
            <DropdownMenuItem disabled>
              {isPending ? 'Loading chats…' : error ? 'Chat history unavailable' : 'No chats yet'}
            </DropdownMenuItem>
          ) : (
            chats.slice(0, 50).map((chat) => (
              <DropdownMenuItem
                key={chat.id}
                active={chat.id === chatId}
                onSelect={() => onSelectChat(chat.id)}
              >
                {chat.name}
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <span className='inline-flex'>
            <Chip
              shape='round'
              leftIcon={Plus}
              aria-label='New chat'
              disabled={!chatId}
              onClick={() => onSelectChat(null)}
            />
          </span>
        </Tooltip.Trigger>
        <Tooltip.Content>New chat</Tooltip.Content>
      </Tooltip.Root>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <ChipLink
            shape='round'
            href={appHref}
            target='_blank'
            rel='noopener noreferrer'
            leftIcon={ArrowUpRight}
            aria-label='Open in Sim'
          />
        </Tooltip.Trigger>
        <Tooltip.Content>Open in Sim</Tooltip.Content>
      </Tooltip.Root>
    </header>
  )
}

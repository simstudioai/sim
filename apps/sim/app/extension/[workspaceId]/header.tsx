'use client'

import {
  Button,
  Chip,
  ChipLink,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@sim/emcn'
import { ArrowUpRight, BubbleChatDelay, ChevronDown, Plus } from '@sim/emcn/icons'
import { useRouter } from 'next/navigation'
import { useMothershipChats } from '@/hooks/queries/mothership-chats'
import { useWorkspacesQuery } from '@/hooks/queries/workspace'

interface ExtensionHeaderProps {
  workspaceId: string
  workspaceName: string
  chatId?: string
  onSelectChat: (chatId: string | null) => void
  appHref: string
}

export function ExtensionHeader({
  workspaceId,
  workspaceName,
  chatId,
  onSelectChat,
  appHref,
}: ExtensionHeaderProps) {
  const router = useRouter()
  const { data: workspaces } = useWorkspacesQuery()
  const { data: chats, isPending, error } = useMothershipChats(workspaceId)
  return (
    <header className='flex shrink-0 items-center gap-1 border-[var(--border)] border-b px-3 py-2'>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Chip rightIcon={ChevronDown} className='min-w-0 flex-1'>
            {workspaceName}
          </Chip>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='start'>
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
        <DropdownMenuTrigger asChild>
          <Button variant='ghost' size='icon' aria-label='Chat history'>
            <BubbleChatDelay className='size-[14px]' />
          </Button>
        </DropdownMenuTrigger>
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
      <Button
        variant='ghost'
        size='icon'
        aria-label='New chat'
        disabled={!chatId}
        onClick={() => onSelectChat(null)}
      >
        <Plus className='size-[14px]' />
      </Button>
      <ChipLink
        href={appHref}
        target='_blank'
        rel='noopener noreferrer'
        leftIcon={ArrowUpRight}
        mobileIconOnly
      >
        Open in Sim
      </ChipLink>
    </header>
  )
}

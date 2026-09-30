'use client'

import { notFound } from 'next/navigation'
import { ChatSurface } from '@/app/playground/org/components/chat-surface'
import { useProtoChats } from '@/app/playground/org/lib/chat-store'
import { CHATS, type Chat } from '@/app/playground/org/lib/mock-data'
import { parseProtoRoute } from '@/app/playground/org/lib/routes'

const NEW_CHAT: Chat = { id: 'new', title: 'New chat', age: 'now' }

/** Client-side router for the prototype's catch-all route. */
export function ProtoPage({ slug }: { slug?: string[] }) {
  const created = useProtoChats((state) => state.created)
  const route = parseProtoRoute(slug)
  if (!route) notFound()

  switch (route.kind) {
    case 'home':
      return <ChatSurface key='new' chat={NEW_CHAT} fresh />
    case 'search':
      return <Placeholder title='Search' body='Org-wide search stays as it is today.' />
    case 'connectors':
      return <Placeholder title='Connectors' body='Slack, Linear, Jira, Zendesk, and the rest.' />
    case 'chat': {
      const started = created.find((c) => c.id === route.chatId)
      const chat =
        route.chatId === 'new' ? NEW_CHAT : (started ?? CHATS.find((c) => c.id === route.chatId))
      if (!chat) notFound()
      return (
        <ChatSurface key={chat.id} chat={chat} fresh={route.chatId === 'new' || Boolean(started)} />
      )
    }
  }
}

function Placeholder({ title, body }: { title: string; body: string }) {
  return (
    <div className='flex h-full flex-col items-center justify-center gap-2'>
      <h1 className='text-[20px] text-[var(--text-primary)]'>{title}</h1>
      <p className='text-[var(--text-muted)] text-small'>{body}</p>
    </div>
  )
}

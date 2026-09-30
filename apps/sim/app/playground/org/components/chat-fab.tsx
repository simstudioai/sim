'use client'

import { ComposerActionButton } from '@sim/emcn'
import { MessageSquareText } from '@sim/emcn/icons'
import { generateShortId } from '@sim/utils/id'
import { useRouter } from 'next/navigation'
import { useProtoChats } from '@/app/playground/org/lib/chat-store'
import { protoRoutes } from '@/app/playground/org/lib/routes'

/** Starts a real chat with `open` (a resource or browse ref) as its first tab, and goes there. */
export function useStartChat() {
  const router = useRouter()
  const createChat = useProtoChats((state) => state.createChat)
  return (open: string) => {
    const id = `c-${generateShortId(8)}`
    createChat({ id, title: 'New chat', age: 'now' })
    router.push(`${protoRoutes.chat(id)}?open=${open}`)
  }
}

interface ChatFabProps {
  /** What the chat opens as its first tab: the page you are on. */
  open: string
}

/** The floating chat button at the bottom left of a project page. */
export function ChatFab({ open }: ChatFabProps) {
  const startChat = useStartChat()
  return (
    <div className='absolute bottom-4 left-4 z-10'>
      <ComposerActionButton
        aria-label='Chat about this page'
        className='size-10'
        onClick={() => startChat(open)}
      >
        <MessageSquareText className='size-[16px] text-white dark:text-black' />
      </ComposerActionButton>
    </div>
  )
}

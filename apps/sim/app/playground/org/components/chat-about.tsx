'use client'

import { Chip } from '@sim/emcn'
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

interface ChatAboutProps {
  /** What the chat opens as its first tab: the page you are on. */
  open: string
}

/** The chat icon at the top right of a project page. */
export function ChatAbout({ open }: ChatAboutProps) {
  const startChat = useStartChat()
  return (
    <Chip
      leftIcon={MessageSquareText}
      aria-label='Chat about this page'
      onClick={() => startChat(open)}
    />
  )
}

import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import type { Chat } from '@/app/playground/org/lib/mock-data'

interface ProtoChatsState {
  /** Chats started in this session, newest first; the mock list holds the rest. */
  created: Chat[]
  createChat: (chat: Chat) => void
  renameChat: (id: string, title: string) => void
}

export const useProtoChats = create<ProtoChatsState>()(
  devtools(
    (set) => ({
      created: [],
      createChat: (chat) => set((state) => ({ created: [chat, ...state.created] })),
      renameChat: (id, title) =>
        set((state) => ({
          created: state.created.map((chat) => (chat.id === id ? { ...chat, title } : chat)),
        })),
    }),
    { name: 'proto-chats' }
  )
)

'use client'

import { MessageComposer } from '@/platform/app/(shell)/_components/composer/message-composer'
import type { HomeMode } from '@/platform/app/(shell)/_components/model'
import { useComposerHost } from '@/platform/app/(shell)/_components/session/composer-host'
import type { HomeData } from '@/platform/app/(shell)/home/_components/model'

interface HomeComposerProps {
  inventory?: HomeData['composerInventory']
  mode: HomeMode
}

export function HomeComposer({ inventory, mode }: HomeComposerProps) {
  const host = useComposerHost()
  const startChat = host.useStartChat()
  const startSearch = host.useStartSearch()
  const composer = host.useComposer({ ...inventory, draftKey: 'home', requestMode: 'agent' })
  return (
    <MessageComposer
      composer={composer}
      placeholder={
        mode === 'Build'
          ? 'Ask about your business, or give Sim something to do…'
          : 'Search your company’s knowledge…'
      }
      onSubmit={(draft) => {
        if (mode === 'Search' && startSearch) {
          if (!draft.text) return false
          startSearch(draft.text)
          return undefined
        }
        return startChat(draft)
      }}
    />
  )
}

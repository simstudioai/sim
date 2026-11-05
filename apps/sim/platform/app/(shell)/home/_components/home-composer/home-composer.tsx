'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { MessageComposer } from '@/platform/app/(shell)/_components/composer/message-composer'
import { userTurn } from '@/platform/app/(shell)/_components/composer/user-turn'
import type { HomeMode } from '@/platform/app/(shell)/_components/model'
import { useChatChanges } from '@/platform/app/(shell)/_components/session/chat-changes'
import styles from '@/platform/app/(shell)/home/_components/home-composer/home-composer.module.css'
import type { HomeData } from '@/platform/app/(shell)/home/_components/model'
import { Icon, SegmentedControl } from '@/platform/design-system/components'
import { platformHref } from '@/platform/design-system/navigation'

interface HomeComposerProps {
  references?: HomeData['references']
  mode: HomeMode
  onModeChange: (mode: HomeMode) => void
}

export function HomeComposer({ references, mode, onModeChange }: HomeComposerProps) {
  const router = useRouter()
  const search = useSearchParams()
  const { createChat } = useChatChanges()
  return (
    <section className={styles.composer} aria-label='Start a conversation'>
      <header className={styles.heading}>
        <span className={styles.wordmark}>
          <Icon name='I113' label='Sim' />
        </span>
        <SegmentedControl
          label='Mode'
          options={[
            { value: 'Build', label: 'Build' },
            { value: 'Search', label: 'Search' },
          ]}
          value={mode}
          onSelect={onModeChange}
        />
      </header>
      <MessageComposer
        draftKey='home'
        references={references}
        placeholder={
          mode === 'Build'
            ? 'Ask about your business, or give Sim something to do…'
            : 'Search your company’s knowledge…'
        }
        onSubmit={(draft) => {
          const id = createChat(
            draft.text.slice(0, 70) || draft.attachments[0]?.name || 'New chat',
            [userTurn(draft)]
          )
          router.push(platformHref(`/chat/${id}`, search))
        }}
      />
    </section>
  )
}

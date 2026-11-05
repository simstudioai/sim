'use client'

import { MessageComposer } from '@/platform/app/(shell)/_components/composer/message-composer'
import type { HomeMode } from '@/platform/app/(shell)/_components/model'
import { useComposerHost } from '@/platform/app/(shell)/_components/session/composer-host'
import styles from '@/platform/app/(shell)/home/_components/home-composer/home-composer.module.css'
import type { HomeData } from '@/platform/app/(shell)/home/_components/model'
import { Icon, SegmentedControl } from '@/platform/design-system/components'

interface HomeComposerProps {
  references?: HomeData['references']
  mode: HomeMode
  onModeChange: (mode: HomeMode) => void
}

export function HomeComposer({ references, mode, onModeChange }: HomeComposerProps) {
  const host = useComposerHost()
  const startChat = host.useStartChat()
  const startSearch = host.useStartSearch()
  const composer = host.useComposer({ draftKey: 'home', references, requestMode: 'agent' })
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
    </section>
  )
}

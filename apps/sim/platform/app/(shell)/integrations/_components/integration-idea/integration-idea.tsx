'use client'

import { Icon } from '@sim/emcn/icon'
import { MessageBubble } from '@sim/emcn-platform/message-bubble'
import { useHomePrompt } from '@/platform/app/(shell)/_components/session/composer-host'
import styles from '@/platform/app/(shell)/integrations/_components/integration-idea/integration-idea.module.css'
import { publicAssetPath } from '@/platform/lib/navigation'

interface IntegrationIdeaProps {
  providerId: string
  name: string
  example: string
}

export function IntegrationIdea({ providerId, name, example }: IntegrationIdeaProps) {
  const preparePrompt = useHomePrompt()
  return (
    <section className={styles.idea} aria-label={`Idea for ${name}`}>
      <img
        className={styles.artwork}
        src={publicAssetPath('/integration-artwork/meeting-world.webp')}
        alt=''
        width={2172}
        height={724}
      />
      <div className={styles.message}>
        <MessageBubble
          label={`Use ${name} idea`}
          onSelect={preparePrompt ? () => preparePrompt(example) : undefined}
        >
          <span className={styles.mark}>
            <Icon providerId={providerId} />
          </span>
          {example}
        </MessageBubble>
      </div>
    </section>
  )
}

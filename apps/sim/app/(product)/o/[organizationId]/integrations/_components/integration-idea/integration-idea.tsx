'use client'

import { Icon } from '@sim/emcn/icon'
import { MessageBubble } from '@sim/emcn-platform/message-bubble'
import { PageOverflow } from '@sim/emcn-platform/page-column'
import { useHomePrompt } from '@/app/(product)/_components/session/composer-host'
import styles from '@/app/(product)/o/[organizationId]/integrations/_components/integration-idea/integration-idea.module.css'

interface IntegrationIdeaProps {
  providerId: string
  name: string
  example: string
}

export function IntegrationIdea({ providerId, name, example }: IntegrationIdeaProps) {
  const preparePrompt = useHomePrompt()
  return (
    <PageOverflow>
      <section className={styles.idea} aria-label={`Idea for ${name}`}>
        <img
          className={styles.artwork}
          src='/integration-artwork/meeting-world.webp'
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
    </PageOverflow>
  )
}

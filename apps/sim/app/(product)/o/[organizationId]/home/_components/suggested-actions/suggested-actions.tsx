'use client'

import { ActivityRow } from '@sim/emcn/activity-row'
import { Icon } from '@sim/emcn/icon'
import { HomeSection } from '@/app/(product)/_components/home-section/home-section'
import { useHomePrompt } from '@/app/(product)/_components/session/composer-host'
import styles from '@/app/(product)/o/[organizationId]/home/_components/suggested-actions/suggested-actions.module.css'
import type { HomeSuggestion } from '@/platform/shared/home'

interface SuggestedActionsProps {
  items: readonly HomeSuggestion[]
}

/** A prompt fills the Build draft without sending it; a service row opens where it connects. */
export function SuggestedActions({ items }: SuggestedActionsProps) {
  const prompt = useHomePrompt()
  return (
    <HomeSection title='Suggested actions'>
      <ul className={styles.entries}>
        {items.map((item) =>
          item.kind === 'integration' ? (
            <ActivityRow
              key={item.id}
              leading={<Icon providerId={item.providerId} />}
              title={item.label}
              href={item.href}
            />
          ) : (
            prompt && (
              <ActivityRow
                key={item.id}
                leading={
                  item.providerId ? <Icon providerId={item.providerId} /> : <Icon name='I033' />
                }
                title={item.label}
                onOpen={() => prompt(item.prompt)}
              />
            )
          )
        )}
      </ul>
    </HomeSection>
  )
}

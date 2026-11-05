import type { ReactNode, Ref } from 'react'
import styles from '@/platform/app/(shell)/integrations/_components/provider-heading/provider-heading.module.css'
import { Icon } from '@/platform/design-system/components'

interface ProviderHeadingProps {
  name: string
  description?: string
  providerId?: string
  credential?: { label: string; status: string }
  action?: ReactNode
  titleRef?: Ref<HTMLHeadingElement>
}

export function ProviderHeading({
  name,
  description,
  providerId,
  credential,
  action,
  titleRef,
}: ProviderHeadingProps) {
  return (
    <header className={styles.header}>
      <span className={styles.mark}>
        {providerId ? <Icon providerId={providerId} /> : <Icon name='I070' />}
      </span>
      <h1
        ref={titleRef}
        tabIndex={titleRef ? -1 : undefined}
        className={styles.title}
        data-type='T076'
      >
        {name}
      </h1>
      {action && <div className={styles.actions}>{action}</div>}
      {(description || credential) && (
        <div className={styles.copy}>
          {description && <p data-type='T048'>{description}</p>}
          {credential && (
            <p data-type='T050'>
              {credential.status}
              {' · '}
              <span>{credential.label}</span>
            </p>
          )}
        </div>
      )}
    </header>
  )
}

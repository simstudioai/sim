import type { ReactNode, Ref } from 'react'
import styles from '@/platform/app/(shell)/integrations/_components/provider-heading/provider-heading.module.css'
import { Icon } from '@/platform/design-system/components'

interface ProviderHeadingProps {
  name: string
  description: string
  providerId?: string
  children?: ReactNode
  titleRef?: Ref<HTMLHeadingElement>
}

export function ProviderHeading({
  name,
  description,
  providerId,
  children,
  titleRef,
}: ProviderHeadingProps) {
  return (
    <header className={styles.header}>
      <span className={styles.mark}>
        {providerId ? <Icon providerId={providerId} /> : <Icon name='I070' />}
      </span>
      <div className={styles.content}>
        <div className={styles.copy}>
          <h1 ref={titleRef} tabIndex={titleRef ? -1 : undefined} data-type='T076'>
            {name}
          </h1>
          <p data-type='T048'>{description}</p>
        </div>
        {children}
      </div>
    </header>
  )
}

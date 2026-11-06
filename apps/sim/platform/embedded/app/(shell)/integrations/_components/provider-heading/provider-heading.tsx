import type { ComponentType, Ref } from 'react'
import { IntegrationMark } from '@/platform/embedded/app/(shell)/integrations/_components/integration-mark/integration-mark'
import styles from '@/platform/embedded/app/(shell)/integrations/_components/provider-heading/provider-heading.module.css'

interface ProviderHeadingProps {
  name: string
  description: string
  providerId?: string
  icon?: ComponentType<{ className?: string }>
  titleRef?: Ref<HTMLHeadingElement>
}

export function ProviderHeading({
  name,
  description,
  providerId,
  icon,
  titleRef,
}: ProviderHeadingProps) {
  return (
    <header className={styles.header}>
      <span className={styles.mark}>
        <IntegrationMark providerId={providerId} icon={icon} />
      </span>
      <div className={styles.copy}>
        <h1 ref={titleRef} tabIndex={titleRef ? -1 : undefined} data-type='T076'>
          {name}
        </h1>
        <p data-type='T060'>{description}</p>
      </div>
    </header>
  )
}

import type { ComponentType, Ref } from 'react'
import { IntegrationMark } from '@/platform/app/(shell)/integrations/_components/integration-mark/integration-mark'
import { IntegrationUsage } from '@/platform/app/(shell)/integrations/_components/integration-usage/integration-usage'
import styles from '@/platform/app/(shell)/integrations/_components/provider-heading/provider-heading.module.css'
import type { IntegrationPerson } from '@/platform/lib/integrations/center-model'

interface ProviderHeadingProps {
  name: string
  description: string
  providerId?: string
  icon?: ComponentType<{ className?: string }>
  titleRef?: Ref<HTMLHeadingElement>
  people?: readonly IntegrationPerson[]
  peopleTotal?: number
}

export function ProviderHeading({
  name,
  description,
  providerId,
  icon,
  titleRef,
  people,
  peopleTotal,
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
        <p data-type='T048'>{description}</p>
        {people && <IntegrationUsage people={people} total={peopleTotal} expanded />}
      </div>
    </header>
  )
}

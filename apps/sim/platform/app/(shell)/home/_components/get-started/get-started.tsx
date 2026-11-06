import styles from '@/platform/app/(shell)/home/_components/get-started/get-started.module.css'
import { HomeSection } from '@/platform/app/(shell)/home/_components/home-section/home-section'
import type { HomeGetStartedStep } from '@/platform/app/(shell)/home/_components/model'
import { ActivityRow, Icon } from '@/platform/design-system/components'

interface GetStartedProps {
  steps: readonly HomeGetStartedStep[]
}

export function GetStarted({ steps }: GetStartedProps) {
  return (
    <HomeSection title='Get started'>
      <ul className={styles.entries}>
        {steps.map((step) => (
          <ActivityRow
            key={step.id}
            leading={<Icon name={step.complete ? 'I072' : 'I070'} />}
            title={step.title}
            detail={step.detail}
            textMetadata={step.complete ? 'Done' : undefined}
            href={step.href}
          />
        ))}
      </ul>
    </HomeSection>
  )
}

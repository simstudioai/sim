import { HomeSection } from '@/platform/app/(shell)/home/_components/home-section/home-section'
import type { IconName } from '@/platform/design-system/catalog/icon-geometry'
import { RowList } from '@/platform/design-system/components'
import { ActivityRow } from '@/platform/design-system/components/activity-row/activity-row'
import { Icon } from '@/platform/design-system/components/icon/icon'
import type { HomeGetStartedStep } from '@/platform/lib/data/home-view'

const STEP_ICONS: Readonly<Record<string, IconName>> = {
  'connect-integration': 'I070',
  'connect-sim-search': 'I126',
}

interface GetStartedProps {
  steps: readonly HomeGetStartedStep[]
}

export function GetStarted({ steps }: GetStartedProps) {
  return (
    <HomeSection title='Get started'>
      <RowList dividers>
        {steps.map((step) => (
          <ActivityRow
            key={step.id}
            leading={<Icon name={step.complete ? 'I072' : STEP_ICONS[step.id]} />}
            title={step.title}
            detail={step.detail}
            metadata={step.complete ? 'Done' : undefined}
            href={step.href}
          />
        ))}
      </RowList>
    </HomeSection>
  )
}

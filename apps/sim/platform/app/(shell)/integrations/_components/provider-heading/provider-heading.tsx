import type { ComponentType, Ref } from 'react'
import { DirectoryHeading } from '@/platform/app/(shell)/_components/resource-directory/resource-directory'
import { IntegrationMark } from '@/platform/app/(shell)/integrations/_components/integration-mark/integration-mark'
import { IntegrationUsage } from '@/platform/app/(shell)/integrations/_components/integration-usage/integration-usage'
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
    <DirectoryHeading
      title={name}
      titleRef={titleRef}
      description={description}
      leading={<IntegrationMark providerId={providerId} icon={icon} />}
    >
      {people && <IntegrationUsage people={people} total={peopleTotal} expanded />}
    </DirectoryHeading>
  )
}

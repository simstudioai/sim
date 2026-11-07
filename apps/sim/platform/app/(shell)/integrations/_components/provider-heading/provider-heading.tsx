import type { ComponentType, Ref } from 'react'
import { DirectoryHeading } from '@/platform/app/(shell)/_components/resource-directory/resource-directory'
import { IntegrationMark } from '@/platform/app/(shell)/integrations/_components/integration-mark/integration-mark'

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
    <DirectoryHeading
      title={name}
      titleRef={titleRef}
      description={description}
      leading={<IntegrationMark providerId={providerId} icon={icon} />}
    />
  )
}

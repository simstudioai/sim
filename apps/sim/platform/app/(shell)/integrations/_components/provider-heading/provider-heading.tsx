import type { ComponentType, Ref } from 'react'
import { BrandMark } from '@/platform/app/(shell)/_components/brand-mark/brand-mark'
import { DirectoryHeading } from '@/platform/app/(shell)/_components/resource-directory/resource-directory'

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
      leading={<BrandMark providerId={providerId} icon={icon} />}
    />
  )
}

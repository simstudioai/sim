import type { ReactNode } from 'react'
import {
  type SearchSource,
  sourceDescription,
} from '@/platform/app/(shell)/settings/_components/sections/integrations/model'
import { Icon } from '@/platform/design-system/components'
import { SettingsRow } from '@/platform/design-system/components/settings-section/settings-section'

interface SourceRowProps {
  source: SearchSource
  children: ReactNode
}

export function SourceRow({ source, children }: SourceRowProps) {
  return (
    <SettingsRow
      label={source.name}
      description={sourceDescription(source)}
      leading={<Icon providerId={source.id} />}
    >
      {children}
    </SettingsRow>
  )
}

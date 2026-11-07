import type { ReactNode } from 'react'
import { Icon } from '@sim/emcn/icon'
import { SettingsRow } from '@sim/emcn/settings-section'
import {
  type SearchSource,
  sourceDescription,
} from '@/platform/app/(shell)/settings/_components/sections/integrations/model'

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

import type { ReactNode } from 'react'
import { RESOURCE_LIST_GRID } from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'

interface IntegrationSectionProps {
  label: string
  children: ReactNode
}

/**
 * Labeled section used throughout the integrations surface: the shared
 * {@link SettingsSection} label/divider chrome wrapped around the shared
 * responsive card grid, so the integrations list, the connected credentials
 * list, and the integration detail templates cannot drift from settings.
 */
export function IntegrationSection({ label, children }: IntegrationSectionProps) {
  return (
    <SettingsSection label={label}>
      <div className={RESOURCE_LIST_GRID}>{children}</div>
    </SettingsSection>
  )
}

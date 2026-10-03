import type { ReactNode } from 'react'
import {
  RESOURCE_LIST_GRID,
  RESOURCE_LIST_STACK,
} from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'

interface IntegrationSectionProps {
  label: string
  description?: string
  layout?: 'grid' | 'list'
  children: ReactNode
}

/**
 * Labeled section used throughout the integrations surface: the shared
 * {@link SettingsSection} label/divider chrome wrapped around the shared
 * resource grid or list, so the integrations list, the connected credentials
 * list, and the integration detail templates cannot drift from settings.
 */
export function IntegrationSection({
  label,
  description,
  layout = 'grid',
  children,
}: IntegrationSectionProps) {
  return (
    <SettingsSection label={label}>
      {description && (
        <p className='mb-3 text-[var(--text-muted)] text-caption leading-relaxed'>{description}</p>
      )}
      <div className={layout === 'list' ? RESOURCE_LIST_STACK : RESOURCE_LIST_GRID}>{children}</div>
    </SettingsSection>
  )
}
